-- ============================================================
-- 016: флоу модерации новелл
-- - Добавляем reviewed_at / reviewer_id для аудита
-- - RPC submit_novel_for_review(novel_id): draft/rejected → pending
-- - RPC review_novel(novel_id, approve, note): админ решает, пишет причину
-- - Триггер на смену moderation_status → уведомления переводчику / админам
-- Зависит от 004 (колонки статуса), 007 (уведомления).
-- Безопасно для tene.fun: существующие данные на published не трогаем.
-- ============================================================

ALTER TABLE public.novels
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewer_id uuid REFERENCES auth.users(id);

-- Существующие новеллы из tene уже 'published' — ничего не мигрируем.
-- Новые пойдут через форму с дефолтом 'draft'.

-- Добавляем в novels_view колонки, нужные модерации: rejection_reason,
-- reviewed_at, created_at. Остальные поля view сохраняем как были.
DROP VIEW IF EXISTS public.novels_view CASCADE;

CREATE VIEW public.novels_view AS
SELECT
  n.id,
  n.firebase_id,
  n.title,
  n.title_original,
  n.title_en,
  n.author,
  n.author_original,
  n.author_en,
  n.description,
  n.cover_url,
  n.genres,
  n.latest_chapter_published_at,
  n.is_completed,
  n.epub_path,
  n.translator_id,
  n.country,
  n.age_rating,
  n.translation_status,
  n.release_year,
  n.moderation_status,
  n.rejection_reason,
  n.reviewed_at,
  n.reviewer_id,
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

-- ---- RPC: переводчик шлёт новеллу на модерацию -------------

CREATE OR REPLACE FUNCTION public.submit_novel_for_review(p_novel bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_owner uuid;
  v_status text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT translator_id, moderation_status
  INTO v_owner, v_status
  FROM public.novels WHERE id = p_novel;

  IF v_owner IS NULL THEN RAISE EXCEPTION 'novel not found'; END IF;
  IF v_owner <> auth.uid() THEN
    -- админ тоже может за переводчика дёрнуть
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (is_admin = true OR role = 'admin')
    ) THEN
      RAISE EXCEPTION 'not novel owner';
    END IF;
  END IF;

  IF v_status NOT IN ('draft', 'rejected') THEN
    RAISE EXCEPTION 'can only submit draft or rejected novels, current: %', v_status;
  END IF;

  UPDATE public.novels
  SET moderation_status = 'pending',
      rejection_reason  = NULL,
      reviewed_at       = NULL,
      reviewer_id       = NULL
  WHERE id = p_novel;
END $$;

GRANT EXECUTE ON FUNCTION public.submit_novel_for_review(bigint) TO authenticated;

-- ---- RPC: админ ревьюит ------------------------------------

CREATE OR REPLACE FUNCTION public.review_novel(
  p_novel   bigint,
  p_approve boolean,
  p_note    text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND (is_admin = true OR role = 'admin')
  ) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT moderation_status INTO v_status
  FROM public.novels WHERE id = p_novel;

  IF v_status IS NULL THEN RAISE EXCEPTION 'novel not found'; END IF;

  IF p_approve THEN
    UPDATE public.novels
    SET moderation_status = 'published',
        rejection_reason  = NULL,
        reviewed_at       = now(),
        reviewer_id       = auth.uid()
    WHERE id = p_novel;
  ELSE
    IF p_note IS NULL OR char_length(btrim(p_note)) < 3 THEN
      RAISE EXCEPTION 'rejection note required';
    END IF;
    UPDATE public.novels
    SET moderation_status = 'rejected',
        rejection_reason  = p_note,
        reviewed_at       = now(),
        reviewer_id       = auth.uid()
    WHERE id = p_novel;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.review_novel(bigint, boolean, text) TO authenticated;

-- ---- Триггер: уведомления на смену статуса -----------------

CREATE OR REPLACE FUNCTION public.trg_notify_novel_moderation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admin_id uuid;
BEGIN
  IF OLD.moderation_status IS NOT DISTINCT FROM NEW.moderation_status THEN
    RETURN NEW;
  END IF;

  -- Переводчик прислал на модерацию → все админы получают уведомление
  IF NEW.moderation_status = 'pending' THEN
    FOR v_admin_id IN
      SELECT id FROM public.profiles
      WHERE is_admin = true OR role = 'admin'
    LOOP
      INSERT INTO public.notifications
        (user_id, type, text, target_url, actor_id, group_key, ref_novel_id)
      VALUES
        (v_admin_id,
         'novel_pending',
         'Новелла «' || NEW.title || '» прислана на модерацию',
         '/admin/moderation',
         NEW.translator_id,
         'novel_pending:' || NEW.id,
         NEW.id);
    END LOOP;
    RETURN NEW;
  END IF;

  -- Админ одобрил / отклонил → уведомление переводчику
  IF NEW.moderation_status IN ('published', 'rejected')
     AND OLD.moderation_status = 'pending'
     AND NEW.translator_id IS NOT NULL THEN
    INSERT INTO public.notifications
      (user_id, type, text, target_url, actor_id, group_key, ref_novel_id)
    VALUES
      (NEW.translator_id,
       CASE WHEN NEW.moderation_status = 'published'
            THEN 'novel_approved' ELSE 'novel_rejected' END,
       CASE WHEN NEW.moderation_status = 'published'
            THEN 'Новелла «' || NEW.title || '» одобрена и опубликована'
            ELSE 'Новелла «' || NEW.title || '» отклонена: '
                 || COALESCE(NEW.rejection_reason, 'причина не указана')
       END,
       '/admin/novels/' || NEW.firebase_id || '/edit',
       NEW.reviewer_id,
       'novel_review:' || NEW.id,
       NEW.id);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_novel_moderation_change ON public.novels;
CREATE TRIGGER on_novel_moderation_change
  AFTER UPDATE OF moderation_status ON public.novels
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_novel_moderation();
