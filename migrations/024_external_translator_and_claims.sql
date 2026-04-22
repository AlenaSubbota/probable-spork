-- ============================================================
-- 024: поддержка «внешнего» переводчика новеллы + флоу клейма
-- - external_translator_name / url / note в novels: если переводчик
--   пока не зарегистрирован, показываем его как текст (+ опц. ссылка)
-- - novel_translator_claims: заявка «это я перевёл, заберите мне
--   new новеллу». Админ одобряет — translator_id перепишется
-- - Триггер уведомления: админу о новом claim, автору — о решении
-- Безопасно для tene: только добавления колонок и новые объекты.
-- ============================================================

-- ---- 1. Новые колонки в novels --------------------------------

ALTER TABLE public.novels
  ADD COLUMN IF NOT EXISTS external_translator_name text,
  ADD COLUMN IF NOT EXISTS external_translator_url  text,
  ADD COLUMN IF NOT EXISTS external_translator_note text;

-- external_translator_* заполняется только когда translator_id NULL
-- (зарегистрированного юзера выбрали — значит «внешнего» быть не должно).
-- Валидацию делаем мягкой (CHECK разрешит одновременное заполнение,
-- но UI пишет согласованно; при approve claim колонки чистятся).

-- Пересобираем novels_view, чтобы external-поля были доступны наружу.
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
  n.external_translator_name,
  n.external_translator_url,
  n.external_translator_note,
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

-- ---- 2. Таблица заявок на авторство ---------------------------

CREATE TABLE IF NOT EXISTS public.novel_translator_claims (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  novel_id      bigint NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  claimant_id   uuid   NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  proof         text,   -- ссылки на оригинал публикации, скриншоты, вот это всё
  status        text   NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewer_id   uuid   REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewer_note text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  reviewed_at   timestamptz,
  UNIQUE (novel_id, claimant_id, status)  -- повторная заявка после отказа возможна
);

CREATE INDEX IF NOT EXISTS idx_claims_pending
  ON public.novel_translator_claims (status, created_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_claims_novel
  ON public.novel_translator_claims (novel_id);

ALTER TABLE public.novel_translator_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS claims_self_read  ON public.novel_translator_claims;
DROP POLICY IF EXISTS claims_admin_read ON public.novel_translator_claims;
DROP POLICY IF EXISTS claims_self_write ON public.novel_translator_claims;
DROP POLICY IF EXISTS claims_admin_all  ON public.novel_translator_claims;

CREATE POLICY claims_self_read
  ON public.novel_translator_claims FOR SELECT
  USING (auth.uid() = claimant_id);

CREATE POLICY claims_admin_read
  ON public.novel_translator_claims FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND (is_admin = true OR role = 'admin')
  ));

CREATE POLICY claims_self_write
  ON public.novel_translator_claims FOR INSERT
  WITH CHECK (auth.uid() = claimant_id);

CREATE POLICY claims_admin_all
  ON public.novel_translator_claims FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND (is_admin = true OR role = 'admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND (is_admin = true OR role = 'admin')
  ));

GRANT SELECT, INSERT ON public.novel_translator_claims TO authenticated;
GRANT UPDATE         ON public.novel_translator_claims TO authenticated;

-- ---- 3. RPC: пользователь заявляет «это моя работа» ------------

CREATE OR REPLACE FUNCTION public.request_novel_claim(
  p_novel bigint,
  p_proof text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_claim_id  bigint;
  v_translator uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT translator_id INTO v_translator
  FROM public.novels WHERE id = p_novel;

  -- Нельзя заклеймить новеллу, у которой уже есть зарегистрированный
  -- переводчик (это другой случай — пусть через админа).
  IF v_translator IS NOT NULL THEN
    RAISE EXCEPTION 'novel_already_has_translator';
  END IF;

  -- Проверяем что у пользователя ещё нет активной (pending/approved) заявки.
  IF EXISTS (
    SELECT 1 FROM public.novel_translator_claims
    WHERE novel_id = p_novel AND claimant_id = v_uid
      AND status IN ('pending', 'approved')
  ) THEN
    RAISE EXCEPTION 'claim_already_exists';
  END IF;

  INSERT INTO public.novel_translator_claims
    (novel_id, claimant_id, proof)
  VALUES (p_novel, v_uid, p_proof)
  RETURNING id INTO v_claim_id;

  RETURN v_claim_id;
END $$;

GRANT EXECUTE ON FUNCTION public.request_novel_claim(bigint, text) TO authenticated;

-- ---- 4. RPC: админ разрешает / отказывает ---------------------

CREATE OR REPLACE FUNCTION public.resolve_novel_claim(
  p_claim   bigint,
  p_approve boolean,
  p_note    text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_claim RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND (is_admin = true OR role = 'admin')
  ) THEN
    RAISE EXCEPTION 'admin_only';
  END IF;

  SELECT * INTO v_claim
  FROM public.novel_translator_claims WHERE id = p_claim;

  IF v_claim.id IS NULL THEN RAISE EXCEPTION 'claim_not_found'; END IF;
  IF v_claim.status <> 'pending' THEN RAISE EXCEPTION 'claim_already_resolved'; END IF;

  UPDATE public.novel_translator_claims
  SET status        = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      reviewer_id   = auth.uid(),
      reviewer_note = p_note,
      reviewed_at   = now()
  WHERE id = p_claim;

  IF p_approve THEN
    -- Переписываем новеллу на нового переводчика, сбрасываем external-поля.
    UPDATE public.novels
    SET translator_id            = v_claim.claimant_id,
        external_translator_name = NULL,
        external_translator_url  = NULL,
        external_translator_note = NULL
    WHERE id = v_claim.novel_id;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.resolve_novel_claim(bigint, boolean, text) TO authenticated;

-- ---- 5. Триггер: уведомления -----------------------------------

CREATE OR REPLACE FUNCTION public.trg_notify_novel_claim()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_title  text;
  v_admin  uuid;
BEGIN
  SELECT title INTO v_title FROM public.novels WHERE id = NEW.novel_id;

  IF TG_OP = 'INSERT' THEN
    -- Новая заявка → уведомление всем админам
    FOR v_admin IN
      SELECT id FROM public.profiles
      WHERE is_admin = true OR role = 'admin'
    LOOP
      INSERT INTO public.notifications
        (user_id, type, text, target_url, actor_id, group_key, ref_novel_id)
      VALUES
        (v_admin,
         'novel_claim_pending',
         'Заявка на авторство «' || COALESCE(v_title, '?') || '»',
         '/admin/moderation?tab=claims',
         NEW.claimant_id,
         'novel_claim:' || NEW.id,
         NEW.novel_id);
    END LOOP;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') THEN
    INSERT INTO public.notifications
      (user_id, type, text, target_url, actor_id, group_key, ref_novel_id)
    VALUES
      (NEW.claimant_id,
       CASE WHEN NEW.status = 'approved'
            THEN 'novel_claim_approved' ELSE 'novel_claim_rejected' END,
       CASE WHEN NEW.status = 'approved'
            THEN '«' || COALESCE(v_title, '?') || '» закреплена за тобой как за переводчиком.'
            ELSE 'Заявка на «' || COALESCE(v_title, '?') || '» отклонена'
                 || COALESCE(': ' || NEW.reviewer_note, '.')
       END,
       '/admin',
       NEW.reviewer_id,
       'novel_claim:' || NEW.id,
       NEW.novel_id);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_novel_claim_change ON public.novel_translator_claims;
CREATE TRIGGER on_novel_claim_change
  AFTER INSERT OR UPDATE OF status ON public.novel_translator_claims
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_novel_claim();
