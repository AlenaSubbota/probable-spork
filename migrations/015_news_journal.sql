-- ============================================================
-- 015: расширяем news_posts под «Журнал» (обзоры, интервью, статьи)
-- - добавляем cover_url / subtitle / rubrics[]
-- - расширяем CHECK type на 'article', 'review', 'interview'
-- Безопасно для tene.fun: только ADD COLUMN IF NOT EXISTS + пересоздание CHECK.
-- ============================================================

ALTER TABLE public.news_posts
  ADD COLUMN IF NOT EXISTS cover_url text,
  ADD COLUMN IF NOT EXISTS subtitle  text,
  ADD COLUMN IF NOT EXISTS rubrics   text[] NOT NULL DEFAULT ARRAY[]::text[];

-- CHECK на type был зашит в миграцию 009 — пересоздаём с расширенным списком
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'news_posts_type_check'
      AND conrelid = 'public.news_posts'::regclass
  ) THEN
    ALTER TABLE public.news_posts DROP CONSTRAINT news_posts_type_check;
  END IF;
END $$;

ALTER TABLE public.news_posts
  ADD CONSTRAINT news_posts_type_check
  CHECK (type IN (
    'announcement', 'event', 'update', 'tip', 'maintenance',
    'article', 'review', 'interview'
  ));

-- Индекс для выборки «журнальных» постов на главной
CREATE INDEX IF NOT EXISTS idx_news_posts_journal
  ON public.news_posts (type, is_published, published_at DESC)
  WHERE type IN ('article', 'review', 'interview');
