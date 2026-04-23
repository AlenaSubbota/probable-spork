-- ============================================================
-- 042: «Звезда недели» — переводчик с наибольшим ростом подписок
-- или покупок глав за последнюю неделю.
--
-- Витрина на главной странице: один переводчик раз в неделю, мягкая
-- ротация. Выбирается не админом, а математикой — кто за 7 дней
-- получил больше всего новых подписок + покупок. Честно для новичков
-- (начальные +3 подписки за неделю тащат вверх).
--
-- RPC возвращает максимум 1 ряд. Если за неделю вообще ничего не
-- происходило — null. На фронте блок просто не рендерится.
-- ============================================================

CREATE OR REPLACE FUNCTION public.star_translator_of_the_week()
RETURNS TABLE (
  translator_id            uuid,
  user_name                text,
  translator_slug          text,
  translator_display_name  text,
  translator_avatar_url    text,
  avatar_url               text,
  new_subscribers          int,
  chapters_published       int,
  coins_earned             int,
  score                    int
)
LANGUAGE sql STABLE
SET search_path = public, pg_catalog
AS $$
  WITH period AS (
    SELECT (now() - interval '7 days') AS since
  ),
  subs AS (
    SELECT translator_id, COUNT(*)::int AS n
    FROM public.subscriptions, period
    WHERE started_at >= period.since
      AND status = 'active'
    GROUP BY translator_id
  ),
  pubs AS (
    -- Новые главы — косвенный сигнал активности
    SELECT n.translator_id, COUNT(c.id)::int AS n
    FROM public.chapters c
    JOIN public.novels n ON n.id = c.novel_id, period
    WHERE c.published_at >= period.since
      AND c.published_at <= now()
      AND n.translator_id IS NOT NULL
    GROUP BY n.translator_id
  ),
  coins AS (
    -- Заработок за неделю. В coin_transactions одна транзакция на событие:
    -- списание у читателя (amount<0) и зачисление переводчику (amount>0)
    -- — две разные строки с одинаковым reference_id. Фильтруем только
    -- положительные зачисления: user_id тогда = переводчик.
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
      -- Баллы: подписка весит 10, глава — 2, одна монета — 0.05.
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

GRANT EXECUTE ON FUNCTION public.star_translator_of_the_week() TO anon, authenticated;
