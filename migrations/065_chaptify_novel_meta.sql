-- ============================================================
-- 065: Chaptify-only метаданные новелл — отделение от tene-схемы
--
-- Проблема: novels.is_completed на tene-сайте означает «перевод
-- завершён, EPUB доступен для скачивания». В Chaptify-админке
-- этот же столбец был подписан как «оригинал завершён», и
-- переводчик, кликая галочку (имея в виду «автор оригинала
-- дописал»), включал у tene показ кнопки «📘 EPUB», хотя его
-- собственный перевод ещё не закончен.
--
-- Решение: отдельная таблица novel_chaptify_meta с собственным
-- флагом original_completed. Tene её не видит и не использует.
-- На стороне Chaptify админ-форма пишет сюда, а
-- mark_stale_translations_abandoned (064) тоже читает «оригинал
-- завершён» отсюда.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.novel_chaptify_meta (
  novel_id           bigint PRIMARY KEY REFERENCES public.novels(id) ON DELETE CASCADE,
  original_completed boolean NOT NULL DEFAULT false,
  updated_at         timestamptz DEFAULT now(),
  updated_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.novel_chaptify_meta IS
  'Chaptify-only метаданные. Тене-сайт сюда не пишет.';
COMMENT ON COLUMN public.novel_chaptify_meta.original_completed IS
  'Автор оригинала дописал работу до конца. Не путать с novels.is_completed (tene использует как «перевод готов, EPUB доступен»).';

ALTER TABLE public.novel_chaptify_meta ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ncm_read_all      ON public.novel_chaptify_meta;
DROP POLICY IF EXISTS ncm_write_owner   ON public.novel_chaptify_meta;

-- Читать может кто угодно (нужно в novels_view и публичных карточках).
CREATE POLICY ncm_read_all
  ON public.novel_chaptify_meta FOR SELECT
  USING (true);

-- Писать может: переводчик новеллы, член её команды или админ.
CREATE POLICY ncm_write_owner
  ON public.novel_chaptify_meta FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.novels n
      WHERE n.id = novel_chaptify_meta.novel_id
        AND (
          n.translator_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND (p.role = 'admin' OR COALESCE(p.is_admin, false) = true)
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.novels n
      WHERE n.id = novel_chaptify_meta.novel_id
        AND (
          n.translator_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND (p.role = 'admin' OR COALESCE(p.is_admin, false) = true)
          )
        )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.novel_chaptify_meta TO authenticated;
GRANT SELECT                         ON public.novel_chaptify_meta TO anon;

-- Триггер: updated_at обновляется автоматически при UPDATE.
CREATE OR REPLACE FUNCTION public.trg_novel_chaptify_meta_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS novel_chaptify_meta_touch ON public.novel_chaptify_meta;
CREATE TRIGGER novel_chaptify_meta_touch
  BEFORE UPDATE ON public.novel_chaptify_meta
  FOR EACH ROW EXECUTE FUNCTION public.trg_novel_chaptify_meta_touch();

-- ------------------------------------------------------------
-- Перезаливаем mark_stale_translations_abandoned (064): теперь
-- читаем «оригинал завершён» из новой таблицы, а не из is_completed
-- (тот уже не управляется Chaptify-формой).
-- ------------------------------------------------------------

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
  SELECT (role = 'admin' OR COALESCE(is_admin, false) = true)
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
      n.id           AS nid,
      n.firebase_id  AS fbid,
      n.title        AS ttl,
      MAX(c.published_at) AS last_pub
    FROM public.novels n
    JOIN public.chapters c ON c.novel_id = n.id
    LEFT JOIN public.novel_chaptify_meta m ON m.novel_id = n.id
    WHERE n.translation_status = 'ongoing'
      AND COALESCE(m.original_completed, false) = false
    GROUP BY n.id, n.firebase_id, n.title
    HAVING MAX(c.published_at) IS NOT NULL
       AND MAX(c.published_at) < (NOW() - (p_threshold_days || ' days')::interval)
  ),
  bumped AS (
    UPDATE public.novels n
       SET translation_status = 'abandoned'
      FROM candidates c
     WHERE n.id = c.nid
    RETURNING n.id AS bid, n.firebase_id AS bfb, n.title AS btitle, c.last_pub AS blast
  )
  SELECT
    b.bid,
    b.bfb,
    b.btitle,
    b.blast,
    EXTRACT(DAY FROM (NOW() - b.blast))::int
  FROM bumped b
  ORDER BY b.blast ASC;
END $$;

GRANT EXECUTE ON FUNCTION public.mark_stale_translations_abandoned(int) TO authenticated;
