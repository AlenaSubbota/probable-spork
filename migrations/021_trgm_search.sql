-- ============================================================
-- 021: нечёткий поиск по новеллам через pg_trgm
-- - расширение pg_trgm (триграммы для similarity/опечаток)
-- - GIN-индексы на title/title_en/title_original/author
-- - RPC search_novels_trgm(q, lim): ранжирование по similarity score
--   + фильтр moderation_status = 'published' (черновики в поиск не светим)
-- Безопасно для tene: только CREATE EXTENSION + CREATE INDEX IF NOT EXISTS + CREATE FUNCTION.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN-индексы на текстовые поля, по которым обычно ищут.
-- gin_trgm_ops делает индекс способным поддержать ILIKE '%...%' и similarity().
CREATE INDEX IF NOT EXISTS idx_novels_title_trgm
  ON public.novels USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_novels_title_en_trgm
  ON public.novels USING gin (title_en gin_trgm_ops)
  WHERE title_en IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_novels_title_original_trgm
  ON public.novels USING gin (title_original gin_trgm_ops)
  WHERE title_original IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_novels_author_trgm
  ON public.novels USING gin (author gin_trgm_ops)
  WHERE author IS NOT NULL;

-- RPC: нечёткий поиск по новеллам.
-- Score: берём максимум similarity среди title / title_en / title_original /
-- author. title_ru весит чуть больше (совпадение по русскому названию — самый
-- сильный сигнал для читателя). Порог низкий, чтобы «наруто» ловило «Naruto».
CREATE OR REPLACE FUNCTION public.search_novels_trgm(
  p_q   text,
  p_lim int DEFAULT 20
) RETURNS TABLE (
  id                  bigint,
  firebase_id         text,
  title               text,
  title_en            text,
  title_original      text,
  author              text,
  cover_url           text,
  genres              jsonb,
  average_rating      numeric,
  chapter_count       int,
  score               real
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH scored AS (
    SELECT
      n.id,
      n.firebase_id,
      n.title,
      n.title_en,
      n.title_original,
      n.author,
      n.cover_url,
      n.genres,
      COALESCE(s.average_rating, 0)::numeric AS average_rating,
      COALESCE((SELECT COUNT(*)::int FROM public.chapters c WHERE c.novel_id = n.id), 0) AS chapter_count,
      GREATEST(
        CASE WHEN n.title          IS NOT NULL THEN similarity(n.title,          p_q) * 1.1 ELSE 0 END,
        CASE WHEN n.title_en       IS NOT NULL THEN similarity(n.title_en,       p_q)       ELSE 0 END,
        CASE WHEN n.title_original IS NOT NULL THEN similarity(n.title_original, p_q)       ELSE 0 END,
        CASE WHEN n.author         IS NOT NULL THEN similarity(n.author,         p_q) * 0.9 ELSE 0 END
      ) AS score
    FROM public.novels n
    LEFT JOIN public.novel_stats s ON s.novel_id = n.id
    WHERE n.moderation_status = 'published'
      AND (
        n.title           % p_q OR
        n.title_en        % p_q OR
        n.title_original  % p_q OR
        n.author          % p_q OR
        n.title           ILIKE '%' || p_q || '%' OR
        n.author          ILIKE '%' || p_q || '%'
      )
  )
  SELECT id, firebase_id, title, title_en, title_original, author, cover_url,
         genres, average_rating, chapter_count, score
  FROM scored
  WHERE score > 0.12
  ORDER BY score DESC, average_rating DESC
  LIMIT p_lim;
$$;

GRANT EXECUTE ON FUNCTION public.search_novels_trgm(text, int) TO authenticated, anon;
