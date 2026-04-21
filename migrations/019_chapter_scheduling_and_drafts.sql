-- ============================================================
-- 019: отложенная публикация + черновики глав
-- - published_at NULL        → черновик (видит только переводчик/админ)
-- - published_at > now()     → запланировано (тоже только переводчик/админ)
-- - published_at <= now()    → опубликовано (видят все)
-- Плюс составной индекс для пагинации списка глав.
-- Безопасно для tene: только ALTER COLUMN DROP NOT NULL (если был) + CREATE INDEX IF NOT EXISTS.
-- ============================================================

-- Снимаем NOT NULL с published_at (если он был). Идемпотентно: если NOT NULL
-- уже нет, ALTER ничего не сломает.
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.chapters ALTER COLUMN published_at DROP NOT NULL;
  EXCEPTION WHEN OTHERS THEN
    -- уже nullable — игнорируем
    NULL;
  END;
END $$;

-- Составной индекс для быстрой пагинации списка глав на странице новеллы.
-- Запрос: WHERE novel_id = $1 ORDER BY chapter_number DESC LIMIT N OFFSET M
CREATE INDEX IF NOT EXISTS idx_chapters_novel_chnum
  ON public.chapters (novel_id, chapter_number DESC);
