-- ============================================================
-- Миграция 002: расширения каталога
-- - novels_view теперь содержит chapter_count
-- - добавлены GIN индекс по жанрам и индекс по latest_chapter
-- Безопасно для tene.fun: все старые колонки view сохранены.
-- ВАЖНО: накатывать ПОСЛЕ 001 (translator_id появляется в 001).
-- ============================================================

DROP VIEW IF EXISTS public.novels_view CASCADE;

CREATE VIEW public.novels_view AS
SELECT
  n.id,
  n.firebase_id,
  n.title,
  n.author,
  n.description,
  n.cover_url,
  n.genres,
  n.latest_chapter_published_at,
  n.is_completed,
  n.epub_path,
  n.translator_id,
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

-- Индексы для фильтрации/сортировки каталога
CREATE INDEX IF NOT EXISTS idx_novels_genres_gin
  ON public.novels USING GIN (genres);

CREATE INDEX IF NOT EXISTS idx_novels_latest_chapter
  ON public.novels (latest_chapter_published_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_chapters_novel_id
  ON public.chapters (novel_id);

CREATE INDEX IF NOT EXISTS idx_chapters_published_at
  ON public.chapters (published_at DESC);
