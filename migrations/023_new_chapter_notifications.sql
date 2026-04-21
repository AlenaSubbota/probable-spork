-- ============================================================
-- 023: уведомления о новой главе подписчикам и тем, у кого новелла в закладках
-- Триггер на chapters:
--   - INSERT с published_at <= now(): разослать
--   - UPDATE OF published_at: если стала "сейчас или раньше" (scheduled → live),
--     тоже разослать
-- Кому: активные подписчики переводчика + все, у кого новелла в profiles.bookmarks
-- Дедуп через UNION. Сам переводчик себе не шлёт.
-- ============================================================

CREATE OR REPLACE FUNCTION public.trg_notify_new_chapter()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_novel        RECORD;
  v_was_live     boolean;
  v_now_live     boolean;
BEGIN
  -- Интересует только момент, когда глава становится видимой.
  v_now_live := NEW.published_at IS NOT NULL AND NEW.published_at <= now();
  IF TG_OP = 'INSERT' THEN
    v_was_live := false;
  ELSE
    v_was_live := OLD.published_at IS NOT NULL AND OLD.published_at <= now();
  END IF;
  IF NOT v_now_live OR v_was_live THEN
    RETURN NEW;
  END IF;

  SELECT id, firebase_id, title, translator_id
  INTO v_novel
  FROM public.novels WHERE id = NEW.novel_id;

  IF v_novel.id IS NULL THEN RETURN NEW; END IF;

  -- Рассылаем. DISTINCT через UNION автоматически дедупит пересечение
  -- (подписчик + закладчик = одно уведомление).
  INSERT INTO public.notifications
    (user_id, type, text, target_url, actor_id, group_key, ref_novel_id)
  SELECT
    u.user_id,
    'new_chapter',
    'Новая глава «' || v_novel.title || '» · глава ' || NEW.chapter_number,
    '/novel/' || v_novel.firebase_id || '/' || NEW.chapter_number,
    v_novel.translator_id,
    'new_chapter:' || v_novel.id,
    v_novel.id
  FROM (
    SELECT s.user_id
    FROM public.subscriptions s
    WHERE s.translator_id = v_novel.translator_id
      AND s.status = 'active'
      AND (s.expires_at IS NULL OR s.expires_at > now())
    UNION
    SELECT p.id AS user_id
    FROM public.profiles p
    WHERE p.bookmarks ? v_novel.firebase_id
  ) u
  WHERE u.user_id IS NOT NULL
    AND u.user_id <> v_novel.translator_id;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_chapter_published_notify ON public.chapters;
CREATE TRIGGER on_chapter_published_notify
  AFTER INSERT OR UPDATE OF published_at ON public.chapters
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_new_chapter();
