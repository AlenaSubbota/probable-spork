-- ============================================================
-- 014: публичные цитаты (для «цитата дня» на главной)
-- - Добавляем is_public flag к user_quotes
-- - RPC random_public_quote(): случайная популярная цитата (public)
-- - RLS-policy, дающая SELECT всем на is_public = true
-- Безопасно для tene.fun: только ALTER ... ADD COLUMN IF NOT EXISTS.
-- Зависит от 003.
-- ============================================================

ALTER TABLE public.user_quotes
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_user_quotes_public
  ON public.user_quotes (is_public, created_at DESC)
  WHERE is_public = true;

-- Публичные цитаты видны всем (включая анонимов).
DROP POLICY IF EXISTS user_quotes_public_read ON public.user_quotes;
CREATE POLICY user_quotes_public_read
  ON public.user_quotes FOR SELECT
  USING (is_public = true);

GRANT SELECT ON public.user_quotes TO anon;

-- RPC: одна случайная публичная цитата вместе с мета-данными.
-- Используется на главной (SSR): не нагружаем DB сортировкой по random()
-- на всей таблице — сначала берём 200 самых свежих публичных, из них
-- уже random().
CREATE OR REPLACE FUNCTION public.random_public_quote()
RETURNS TABLE (
  id             bigint,
  quote_text     text,
  chapter_number int,
  created_at     timestamptz,
  author_name    text,
  novel_id       bigint,
  novel_title    text,
  novel_firebase_id text
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH recent_public AS (
    SELECT q.*
    FROM public.user_quotes q
    WHERE q.is_public = true
    ORDER BY q.created_at DESC
    LIMIT 200
  ),
  picked AS (
    SELECT * FROM recent_public ORDER BY random() LIMIT 1
  )
  SELECT
    p.id,
    p.quote_text,
    p.chapter_number,
    p.created_at,
    COALESCE(pr.user_name, 'Читатель')   AS author_name,
    n.id,
    n.title,
    n.firebase_id
  FROM picked p
  LEFT JOIN public.profiles pr ON pr.id = p.user_id
  LEFT JOIN public.novels   n  ON n.id  = p.novel_id;
$$;

GRANT EXECUTE ON FUNCTION public.random_public_quote() TO anon, authenticated;
