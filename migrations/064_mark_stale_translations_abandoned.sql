-- ============================================================
-- 064: автоматическая пометка «заброшен» для застойных переводов
--
-- Идея: переводчик может забыть выставить translation_status='frozen'
-- или 'abandoned' руками, и тогда новелла висит в каталоге как
-- 'ongoing', хотя последняя глава вышла полгода назад. Это вводит
-- читателя в заблуждение — он зайдёт ждать продолжения, которого
-- нет.
--
-- Решение: RPC `mark_stale_translations_abandoned`, которое находит
-- такие новеллы и переключает им статус. Запускается админом из
-- админки кнопкой (или через cron, если он у нас появится).
--
-- Правила пометки:
--   1) Только translation_status = 'ongoing' → меняем на 'abandoned'.
--      Frozen / completed / abandoned — не трогаем.
--   2) Должна быть хотя бы одна глава (chapter_count > 0). Совсем
--      пустые новеллы пропускаем — они «не начаты», а не «заброшены».
--   3) Последняя глава старше p_threshold_days (по умолчанию 90).
--   4) Оригинал не завершён (is_completed = false). Если оригинал
--      закончен — возможно, переводчик дотянул до конца и просто
--      забыл переключить статус на 'completed'. Не флагаем такие
--      автоматически, пусть переводчик сам решит.
-- ============================================================

CREATE OR REPLACE FUNCTION public.mark_stale_translations_abandoned(
  p_threshold_days int DEFAULT 90
)
RETURNS TABLE (
  novel_id              bigint,
  firebase_id           text,
  title                 text,
  last_chapter_at       timestamptz,
  days_since_last_chap  int
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_is_admin boolean;
BEGIN
  -- Только админ
  SELECT (role = 'admin' OR is_admin = true)
  INTO v_is_admin
  FROM public.profiles
  WHERE id = auth.uid();

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'Only admins can mark stale translations'
      USING ERRCODE = '42501';
  END IF;

  IF p_threshold_days < 30 THEN
    RAISE EXCEPTION 'Threshold must be at least 30 days, got %', p_threshold_days
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT
      n.id,
      n.firebase_id,
      n.title,
      MAX(c.published_at) AS last_pub
    FROM public.novels n
    JOIN public.chapters c ON c.novel_id = n.id
    WHERE n.translation_status = 'ongoing'
      AND COALESCE(n.is_completed, false) = false
    GROUP BY n.id, n.firebase_id, n.title
    HAVING MAX(c.published_at) IS NOT NULL
       AND MAX(c.published_at) < (NOW() - (p_threshold_days || ' days')::interval)
  ),
  bumped AS (
    UPDATE public.novels n
       SET translation_status = 'abandoned'
      FROM candidates c
     WHERE n.id = c.id
    RETURNING n.id, n.firebase_id, n.title, c.last_pub
  )
  SELECT
    b.id,
    b.firebase_id,
    b.title,
    b.last_pub,
    EXTRACT(DAY FROM (NOW() - b.last_pub))::int AS days_since
  FROM bumped b
  ORDER BY b.last_pub ASC;
END $$;

GRANT EXECUTE ON FUNCTION public.mark_stale_translations_abandoned(int) TO authenticated;
