-- ============================================================
-- Миграция 003: цитаты и коллаборативные рекомендации
-- - user_quotes: сохранённые цитаты из глав
-- - get_similar_novels_by_readers: рекомендации по вкусам читателей
-- - chapter_content_preview: RPC для превью первой главы без скачивания файла
-- Безопасно для tene.fun: только новые объекты.
-- Зависит от 001, 002.
-- ============================================================

-- 1. Таблица цитат (киллер-фича читалки)
CREATE TABLE IF NOT EXISTS public.user_quotes (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        uuid    NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  novel_id       bigint  NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  chapter_number integer NOT NULL,
  quote_text     text    NOT NULL CHECK (char_length(quote_text) BETWEEN 3 AND 2000),
  note           text,
  created_at     timestamptz DEFAULT now(),
  CONSTRAINT unique_quote UNIQUE (user_id, novel_id, chapter_number, quote_text)
);

CREATE INDEX IF NOT EXISTS idx_user_quotes_user
  ON public.user_quotes (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_quotes_novel_chapter
  ON public.user_quotes (novel_id, chapter_number);

ALTER TABLE public.user_quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_quotes_self_read   ON public.user_quotes;
DROP POLICY IF EXISTS user_quotes_self_insert ON public.user_quotes;
DROP POLICY IF EXISTS user_quotes_self_delete ON public.user_quotes;

CREATE POLICY user_quotes_self_read
  ON public.user_quotes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY user_quotes_self_insert
  ON public.user_quotes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY user_quotes_self_delete
  ON public.user_quotes FOR DELETE
  USING (auth.uid() = user_id);

GRANT SELECT, INSERT, DELETE ON public.user_quotes TO authenticated;

-- 2. Коллаборативные рекомендации «Созвучие читателей»
-- Пользователи, которые высоко оценили исходную новеллу,
-- → что ещё они высоко оценили?
CREATE OR REPLACE FUNCTION public.get_similar_novels_by_readers(
  p_novel_id bigint,
  p_limit    int DEFAULT 6
) RETURNS TABLE (
  id                 bigint,
  firebase_id        text,
  title              text,
  author             text,
  cover_url          text,
  genres             jsonb,
  average_rating     numeric,
  rating_count       int,
  chapter_count      int,
  is_completed       boolean,
  match_count        int
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH fans AS (
    SELECT user_id
    FROM public.novel_ratings
    WHERE novel_id = p_novel_id AND rating >= 4
  ),
  candidates AS (
    SELECT r.novel_id, COUNT(*)::int AS match_count
    FROM public.novel_ratings r
    JOIN fans f ON f.user_id = r.user_id
    WHERE r.novel_id <> p_novel_id AND r.rating >= 4
    GROUP BY r.novel_id
    HAVING COUNT(*) >= 2
    ORDER BY match_count DESC
    LIMIT p_limit
  )
  SELECT
    nv.id,
    nv.firebase_id,
    nv.title,
    nv.author,
    nv.cover_url,
    nv.genres,
    nv.average_rating,
    nv.rating_count,
    nv.chapter_count,
    nv.is_completed,
    c.match_count
  FROM public.novels_view nv
  JOIN candidates c ON c.novel_id = nv.id
  ORDER BY c.match_count DESC, nv.average_rating DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_similar_novels_by_readers TO authenticated, anon;

-- 3. Темп выхода глав за последние N дней (киллер-фича «Темп перевода»)
-- Возвращает по 1 строке на каждый день, даже если глав не было.
CREATE OR REPLACE FUNCTION public.get_release_pace(
  p_novel_id bigint,
  p_days     int DEFAULT 90
) RETURNS TABLE (
  day        date,
  chapters   int
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH days AS (
    SELECT generate_series(
      (CURRENT_DATE - (p_days - 1))::date,
      CURRENT_DATE,
      '1 day'::interval
    )::date AS day
  )
  SELECT
    d.day,
    COALESCE(COUNT(c.id)::int, 0) AS chapters
  FROM days d
  LEFT JOIN public.chapters c
    ON c.novel_id = p_novel_id
   AND c.published_at::date = d.day
  GROUP BY d.day
  ORDER BY d.day;
$$;

GRANT EXECUTE ON FUNCTION public.get_release_pace TO authenticated, anon;
