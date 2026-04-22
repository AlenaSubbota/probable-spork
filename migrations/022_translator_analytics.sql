-- ============================================================
-- 022: расширенная аналитика переводчика
-- - translator_top_supporters: топ-N читателей по монетам за период
-- - novel_reader_funnel: распределение читателей по главам (drop-off)
-- Безопасно для tene: только новые RPC.
-- ============================================================

-- Топ читателей, которые принесли переводчику больше всего монет за период
-- (покупка глав этого переводчика). Возвращает имя + аватар + сумму.
CREATE OR REPLACE FUNCTION public.translator_top_supporters(
  p_translator uuid,
  p_since      timestamptz DEFAULT (now() - INTERVAL '30 days'),
  p_limit      int DEFAULT 5
) RETURNS TABLE (
  user_id        uuid,
  user_name      text,
  avatar_url     text,
  total_coins    bigint,
  chapter_count  int,
  first_bought_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH me AS (
    SELECT auth.uid() AS uid
  )
  SELECT
    cp.user_id,
    COALESCE(p.user_name, 'Читатель')          AS user_name,
    p.translator_avatar_url                    AS avatar_url,
    SUM(cp.price_coins)::bigint                AS total_coins,
    COUNT(*)::int                              AS chapter_count,
    MIN(cp.paid_at)                            AS first_bought_at
  FROM public.chapter_purchases cp
  LEFT JOIN public.profiles p ON p.id = cp.user_id
  WHERE cp.translator_id = p_translator
    AND cp.paid_at >= p_since
    AND (
      -- Смотреть чужую статистику нельзя: только админ или сам переводчик.
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = (SELECT uid FROM me)
          AND (is_admin = true OR role = 'admin')
      )
      OR (SELECT uid FROM me) = p_translator
    )
  GROUP BY cp.user_id, p.user_name, p.translator_avatar_url
  ORDER BY total_coins DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.translator_top_supporters(uuid, timestamptz, int)
  TO authenticated;

-- Воронка читателей по главам: сколько уникальных юзеров «сейчас находятся»
-- на каждой главе (последняя прочитанная у них). Для drop-off-анализа —
-- куда «падают» читатели этой новеллы.
-- Источник: profiles.last_read jsonb (формат из tene: { "<novel_id>": { chapterId, timestamp } }).
CREATE OR REPLACE FUNCTION public.novel_reader_funnel(p_novel bigint)
RETURNS TABLE (
  chapter_number int,
  readers        int
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_caller      uuid := auth.uid();
  v_translator  uuid;
  v_is_admin    boolean;
BEGIN
  -- Только переводчик этой новеллы или админ
  SELECT translator_id INTO v_translator
  FROM public.novels WHERE id = p_novel;
  SELECT (is_admin = true OR role = 'admin') INTO v_is_admin
  FROM public.profiles WHERE id = v_caller;
  IF NOT COALESCE(v_is_admin, false) AND v_caller <> v_translator THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH readers_at AS (
    SELECT
      (p.last_read -> p_novel::text ->> 'chapterId')::int AS ch
    FROM public.profiles p
    WHERE p.last_read ? p_novel::text
  )
  SELECT
    ra.ch AS chapter_number,
    COUNT(*)::int AS readers
  FROM readers_at ra
  WHERE ra.ch IS NOT NULL
  GROUP BY ra.ch
  ORDER BY ra.ch ASC;
END $$;

GRANT EXECUTE ON FUNCTION public.novel_reader_funnel(bigint) TO authenticated;
