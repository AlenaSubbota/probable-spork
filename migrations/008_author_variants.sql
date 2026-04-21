-- ============================================================
-- Миграция 008: варианты имени автора
-- novels.author уже есть (используем как «на русском»).
-- Добавляем:
--   author_original — имя в языке оригинала (иероглифы и т.п.)
--   author_en       — транслит/английское написание
-- Безопасно для tene: только ADD COLUMN IF NOT EXISTS.
-- ============================================================

ALTER TABLE public.novels
  ADD COLUMN IF NOT EXISTS author_original text,
  ADD COLUMN IF NOT EXISTS author_en       text;

-- Пересоздаём novels_view, чтобы новые колонки были доступны через SELECT *
DROP VIEW IF EXISTS public.novels_view CASCADE;

CREATE VIEW public.novels_view AS
SELECT
  n.id,
  n.firebase_id,
  n.title,
  n.title_original,
  n.title_en,
  n.author,
  n.author_original,
  n.author_en,
  n.description,
  n.cover_url,
  n.genres,
  n.latest_chapter_published_at,
  n.is_completed,
  n.epub_path,
  n.translator_id,
  n.country,
  n.age_rating,
  n.translation_status,
  n.release_year,
  n.moderation_status,
  COALESCE(s.average_rating, 0::numeric) AS average_rating,
  COALESCE(s.rating_count, 0)            AS rating_count,
  COALESCE(s.views, 0)                   AS views,
  COALESCE(c.chapter_count, 0)           AS chapter_count,
  COALESCE(c.last_chapter_at, n.latest_chapter_published_at) AS last_chapter_at
FROM public.novels n
LEFT JOIN public.novel_stats s ON s.novel_id = n.id
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::int     AS chapter_count,
    MAX(published_at) AS last_chapter_at
  FROM public.chapters
  WHERE novel_id = n.id
) c ON true;

ALTER VIEW public.novels_view OWNER TO supabase_admin;

GRANT ALL    ON TABLE public.novels_view TO postgres;
GRANT ALL    ON TABLE public.novels_view TO service_role;
GRANT SELECT ON TABLE public.novels_view TO authenticated, anon;
