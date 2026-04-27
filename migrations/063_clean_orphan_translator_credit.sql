-- ============================================================
-- 063: чистим старого «авто-переводчика» из novel_translators при
-- смене novels.translator_id.
--
-- Контекст. Миграция 039 поставила триггер sync_novel_translator,
-- который AFTER UPDATE OF translator_id ВСТАВЛЯЕТ строку для нового
-- переводчика в novel_translators. Старого по комментарию «не трогаем»
-- триггер оставлял — расчёт был, что админ уберёт руками через
-- CreditsEditor.
--
-- На практике: если в админке/SQL случайно проставили чужой
-- translator_id и сразу откатили на свой — в novel_translators остаётся
-- строка-сирота. View novel_credits её честно отдаёт, и блок «Над
-- новеллой работают» показывает того, кто никогда над новеллой не
-- работал.
--
-- Лечим автоматически — но только для «нетронутых» авто-строк
-- (вид как в INSERT триггера 039: role='translator', share_percent=100,
-- note IS NULL, sort_order=0). Если строку успели кастомизировать
-- (поменяли долю, добавили note, админ-инсерт через CreditsEditor
-- ставит sort_order=maxSort+1 ≥1) — оставляем, считаем что это уже
-- осознанная команда, к translator_id отношения не имеет.
-- ============================================================

CREATE OR REPLACE FUNCTION public.trg_sync_novel_translator()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- INSERT: если translator_id задан — заводим вахтовую строку.
  IF TG_OP = 'INSERT' AND NEW.translator_id IS NOT NULL THEN
    INSERT INTO public.novel_translators
      (novel_id, user_id, role, share_percent, sort_order)
    VALUES
      (NEW.id, NEW.translator_id, 'translator', 100, 0)
    ON CONFLICT (novel_id, user_id, role) DO NOTHING;
    RETURN NEW;
  END IF;

  -- UPDATE translator_id:
  --   1) Удаляем старого, ТОЛЬКО если он сидит как vanilla auto-row.
  --      Кастомные роли/доли админ ставит сам — их не трогаем.
  --   2) Заводим нового (если задан).
  IF TG_OP = 'UPDATE' AND NEW.translator_id IS DISTINCT FROM OLD.translator_id THEN
    IF OLD.translator_id IS NOT NULL THEN
      DELETE FROM public.novel_translators
      WHERE novel_id = NEW.id
        AND user_id = OLD.translator_id
        AND role = 'translator'
        AND share_percent = 100
        AND note IS NULL
        AND sort_order = 0;
    END IF;

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

-- Триггер уже создан мигр. 039 (AFTER INSERT OR UPDATE OF translator_id),
-- CREATE OR REPLACE FUNCTION выше его поведение и обновляет.

-- Одноразовая чистка уже накопившихся сирот: vanilla auto-rows c
-- role='translator', где user_id уже не совпадает с novels.translator_id.
DELETE FROM public.novel_translators nt
USING public.novels n
WHERE nt.novel_id = n.id
  AND nt.role = 'translator'
  AND nt.share_percent = 100
  AND nt.note IS NULL
  AND nt.sort_order = 0
  AND nt.user_id IS DISTINCT FROM n.translator_id;
