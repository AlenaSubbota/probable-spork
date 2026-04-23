-- ============================================================
-- 039: авто-синк novel_translators от novels.translator_id
--
-- Проблема после 034: бэкфилл novel_translators сделан только для
-- существующих новелл. Новые новеллы (через NovelForm) попадают в
-- novels, но не в novel_translators — view novel_credits остаётся
-- пустым для них, и публичный блок «Над новеллой работают» не
-- появляется.
--
-- Лечение: триггер AFTER INSERT OR UPDATE OF translator_id ON novels
-- — автоматически создаёт/обновляет запись translator'а с role='translator',
-- share_percent=100. Если запись уже есть (вручную добавлена в
-- CreditsEditor) — не трогаем долю, только гарантируем существование.
--
-- Плюс повторный бэкфилл, на случай если 034-бэкфилл не прошёл
-- (ON CONFLICT DO NOTHING не удвоит, если записи уже есть).
-- ============================================================

-- Повторный бэкфилл (идемпотентный — ON CONFLICT)
INSERT INTO public.novel_translators (novel_id, user_id, role, share_percent, sort_order)
SELECT n.id, n.translator_id, 'translator', 100, 0
FROM public.novels n
WHERE n.translator_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Триггер
CREATE OR REPLACE FUNCTION public.trg_sync_novel_translator()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- На INSERT — если translator_id задан, заводим строку
  IF TG_OP = 'INSERT' AND NEW.translator_id IS NOT NULL THEN
    INSERT INTO public.novel_translators
      (novel_id, user_id, role, share_percent, sort_order)
    VALUES
      (NEW.id, NEW.translator_id, 'translator', 100, 0)
    ON CONFLICT (novel_id, user_id, role) DO NOTHING;
    RETURN NEW;
  END IF;

  -- На UPDATE translator_id → добавляем нового, старого не удаляем
  -- (может быть в команде с другой ролью, либо админ сам уберёт руками).
  IF TG_OP = 'UPDATE' AND NEW.translator_id IS DISTINCT FROM OLD.translator_id THEN
    IF NEW.translator_id IS NOT NULL THEN
      INSERT INTO public.novel_translators
        (novel_id, user_id, role, share_percent, sort_order)
      VALUES
        (NEW.id, NEW.translator_id, 'translator', 100, 0)
      ON CONFLICT (novel_id, user_id, role) DO NOTHING;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sync_novel_translator ON public.novels;
CREATE TRIGGER sync_novel_translator
  AFTER INSERT OR UPDATE OF translator_id ON public.novels
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_novel_translator();
