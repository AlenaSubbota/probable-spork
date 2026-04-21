-- ============================================================
-- 020: уведомления переводчику о решении по заявке
-- Триггер на translator_applications: pending → approved/rejected
-- шлёт уведомление кандидату с reviewer_note (если задан).
-- Зависит от 004 (таблица заявок), 007 (notifications).
-- ============================================================

CREATE OR REPLACE FUNCTION public.trg_notify_translator_application()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_text       text;
  v_type       text;
  v_target_url text;
BEGIN
  -- Интересуют только переходы из pending в approved/rejected
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF OLD.status <> 'pending' THEN RETURN NEW; END IF;

  IF NEW.status = 'approved' THEN
    v_type := 'translator_application_approved';
    v_text := 'Твоя заявка в переводчики одобрена! Теперь можно добавлять новеллы и главы в админке.';
    v_target_url := '/admin';
  ELSIF NEW.status = 'rejected' THEN
    v_type := 'translator_application_rejected';
    v_text := 'Заявка в переводчики отклонена'
           || CASE
                WHEN NEW.reviewer_note IS NOT NULL AND char_length(btrim(NEW.reviewer_note)) > 0
                  THEN ': ' || NEW.reviewer_note
                ELSE '. Можно отправить новую заявку.'
              END;
    v_target_url := '/translator/apply';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications
    (user_id, type, text, target_url, actor_id, group_key)
  VALUES
    (NEW.user_id,
     v_type,
     v_text,
     v_target_url,
     NEW.reviewer_id,
     'translator_application:' || NEW.id);

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_translator_application_reviewed ON public.translator_applications;
CREATE TRIGGER on_translator_application_reviewed
  AFTER UPDATE OF status ON public.translator_applications
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_translator_application();
