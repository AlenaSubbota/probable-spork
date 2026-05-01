-- ============================================================
-- 076: добиваем переезд читателей-сторон с public.subscriptions
--      на public.chaptify_subscriptions
--
-- Аудит после фикса 075 показал ещё три места, где код Chaptify
-- ходил в мёртвую таблицу public.subscriptions:
--
--   1) get_user_subscription_status() — всегда возвращал active=false.
--   2) star_translator_of_the_week()  — CTE `subs` считал 0 новых
--                                       подписчиков за неделю.
--   3) trigger on_subscription_insert_notify висит на subscriptions
--      и ловит INSERT-ы, которых там больше не бывает →
--      переводчику не приходит уведомление «новый подписчик»
--      ни в сайт, ни в TG-бот.
--
-- can_read_chapter() намеренно НЕ трогаем: миграция 036 явно
-- закрепила за ней tene-флоу (subscriptions), а сайт Chaptify
-- с миграции 053 ходит в can_read_chapter_chaptify, которая уже
-- читает chaptify_subscriptions.
--
-- Чинить всё одной миграцией: схемы chaptify_subscriptions /
-- subscriptions полностью совпадают (user_id, translator_id,
-- status, started_at, expires_at, plan, provider), достаточно
-- поменять имя таблицы.
-- ============================================================

-- ---------- 1. get_user_subscription_status ---------------------

CREATE OR REPLACE FUNCTION public.get_user_subscription_status(p_user uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT jsonb_build_object(
    'active',     bool_or(status = 'active' AND (expires_at IS NULL OR expires_at > now())),
    'expires_at', max(expires_at),
    'plan',       min(plan)
  )
  FROM public.chaptify_subscriptions
  WHERE user_id = p_user;
$$;


-- ---------- 2. star_translator_of_the_week ----------------------

CREATE OR REPLACE FUNCTION public.star_translator_of_the_week()
RETURNS TABLE(
  translator_id            uuid,
  user_name                text,
  translator_slug          text,
  translator_display_name  text,
  translator_avatar_url    text,
  avatar_url               text,
  new_subscribers          integer,
  chapters_published       integer,
  coins_earned             integer,
  score                    integer
)
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
  WITH period AS (
    SELECT (now() - interval '7 days') AS since
  ),
  subs AS (
    SELECT translator_id, COUNT(*)::int AS n
    FROM public.chaptify_subscriptions, period
    WHERE started_at >= period.since
      AND status = 'active'
    GROUP BY translator_id
  ),
  pubs AS (
    SELECT n.translator_id, COUNT(c.id)::int AS n
    FROM public.chapters c
    JOIN public.novels n ON n.id = c.novel_id, period
    WHERE c.published_at >= period.since
      AND c.published_at <= now()
      AND n.translator_id IS NOT NULL
    GROUP BY n.translator_id
  ),
  coins AS (
    SELECT ct.user_id AS translator_id, SUM(ct.amount)::int AS n
    FROM public.coin_transactions ct, period
    WHERE ct.created_at >= period.since
      AND ct.amount > 0
      AND ct.reason IN ('chapter_purchase', 'chapter_tip')
    GROUP BY ct.user_id
  ),
  merged AS (
    SELECT
      COALESCE(subs.translator_id, pubs.translator_id, coins.translator_id) AS tid,
      COALESCE(subs.n, 0)  AS sub_n,
      COALESCE(pubs.n, 0)  AS pub_n,
      COALESCE(coins.n, 0) AS coin_n
    FROM subs
    FULL OUTER JOIN pubs  ON pubs.translator_id  = subs.translator_id
    FULL OUTER JOIN coins ON coins.translator_id = COALESCE(subs.translator_id, pubs.translator_id)
  ),
  scored AS (
    SELECT
      tid,
      sub_n,
      pub_n,
      coin_n,
      (sub_n * 10 + pub_n * 2 + (coin_n / 20))::int AS score
    FROM merged
    WHERE tid IS NOT NULL
  )
  SELECT
    s.tid                                      AS translator_id,
    p.user_name                                AS user_name,
    p.translator_slug                          AS translator_slug,
    p.translator_display_name                  AS translator_display_name,
    p.translator_avatar_url                    AS translator_avatar_url,
    p.avatar_url                               AS avatar_url,
    s.sub_n                                    AS new_subscribers,
    s.pub_n                                    AS chapters_published,
    s.coin_n                                   AS coins_earned,
    s.score                                    AS score
  FROM scored s
  JOIN public.profiles p ON p.id = s.tid
  WHERE s.score > 0
  ORDER BY s.score DESC, s.sub_n DESC, s.pub_n DESC
  LIMIT 1;
$$;


-- ---------- 3. Триггер «новый подписчик» переезжает на ------------
--               chaptify_subscriptions
--
-- Старый триггер on_subscription_insert_notify оставляем висеть
-- на public.subscriptions — в эту таблицу никто не пишет,
-- срабатываний не будет, спам не грозит. Дублируем поведение
-- на chaptify_subscriptions под отдельным именем (имя триггера
-- в Postgres глобальное).

DROP TRIGGER IF EXISTS on_chaptify_subscription_insert_notify
  ON public.chaptify_subscriptions;

CREATE TRIGGER on_chaptify_subscription_insert_notify
  AFTER INSERT ON public.chaptify_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_new_subscription();
