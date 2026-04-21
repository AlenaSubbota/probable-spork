-- ============================================================
-- Миграция 004: модерация + заявки + глоссарий + черновики
-- Зависит от 001, 002, 003.
-- Безопасно для tene.fun: только добавления, RLS на новых таблицах.
-- ============================================================

-- 1. Расширяем novels новыми полями
ALTER TABLE public.novels
  ADD COLUMN IF NOT EXISTS moderation_status   text DEFAULT 'published'
    CHECK (moderation_status IN ('draft', 'pending', 'published', 'rejected')),
  ADD COLUMN IF NOT EXISTS title_original      text,
  ADD COLUMN IF NOT EXISTS title_en            text,
  ADD COLUMN IF NOT EXISTS alt_titles          jsonb,
  ADD COLUMN IF NOT EXISTS country             text
    CHECK (country IN ('kr', 'cn', 'jp', 'other') OR country IS NULL),
  ADD COLUMN IF NOT EXISTS age_rating          text
    CHECK (age_rating IN ('6+', '12+', '16+', '18+') OR age_rating IS NULL),
  ADD COLUMN IF NOT EXISTS translation_status  text DEFAULT 'ongoing'
    CHECK (translation_status IN ('ongoing', 'completed', 'frozen', 'abandoned')),
  ADD COLUMN IF NOT EXISTS release_year        int,
  ADD COLUMN IF NOT EXISTS external_links      jsonb,
  ADD COLUMN IF NOT EXISTS rejection_reason    text;

-- 2. Заявки на роль переводчика
CREATE TABLE IF NOT EXISTS public.translator_applications (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        uuid   NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  motivation     text   NOT NULL CHECK (char_length(motivation) BETWEEN 20 AND 2000),
  portfolio_url  text,
  desired_slug   text,
  languages      text[],
  status         text DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at     timestamptz DEFAULT now(),
  reviewed_at    timestamptz,
  reviewer_id    uuid REFERENCES auth.users(id),
  reviewer_note  text
);

-- Только одна активная (pending) заявка на пользователя
CREATE UNIQUE INDEX IF NOT EXISTS ta_one_pending_per_user
  ON public.translator_applications (user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_translator_applications_status
  ON public.translator_applications (status, created_at DESC);

ALTER TABLE public.translator_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY ta_self_select
  ON public.translator_applications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY ta_self_insert
  ON public.translator_applications FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY ta_admin_all
  ON public.translator_applications FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

GRANT SELECT, INSERT ON public.translator_applications TO authenticated;
GRANT UPDATE         ON public.translator_applications TO authenticated;

-- 3. Глоссарий новеллы (киллер-фича #1)
CREATE TABLE IF NOT EXISTS public.novel_glossaries (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  novel_id         bigint NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  term_original    text   NOT NULL CHECK (char_length(term_original) BETWEEN 1 AND 200),
  term_translation text   NOT NULL CHECK (char_length(term_translation) BETWEEN 1 AND 200),
  category         text
    CHECK (category IN ('character', 'place', 'term', 'technique', 'other') OR category IS NULL),
  note             text,
  created_at       timestamptz DEFAULT now(),
  UNIQUE (novel_id, term_original)
);

CREATE INDEX IF NOT EXISTS idx_novel_glossaries_novel
  ON public.novel_glossaries (novel_id);

ALTER TABLE public.novel_glossaries ENABLE ROW LEVEL SECURITY;

-- Читать могут все (потом будем показывать объяснения в главе)
CREATE POLICY glossary_read_all
  ON public.novel_glossaries FOR SELECT
  USING (true);

-- Писать — только переводчик новеллы или админ
CREATE POLICY glossary_owner_write
  ON public.novel_glossaries FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.novels n
      WHERE n.id = novel_id
        AND (
          n.translator_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
        )
    )
  );

CREATE POLICY glossary_owner_update
  ON public.novel_glossaries FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.novels n
      WHERE n.id = novel_id
        AND (
          n.translator_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
        )
    )
  );

CREATE POLICY glossary_owner_delete
  ON public.novel_glossaries FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.novels n
      WHERE n.id = novel_id
        AND (
          n.translator_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
        )
    )
  );

GRANT SELECT                         ON public.novel_glossaries TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE         ON public.novel_glossaries TO authenticated;

-- 4. Черновики глав (киллер-фича #2)
CREATE TABLE IF NOT EXISTS public.chapter_drafts (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        uuid   NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  novel_id       bigint NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  chapter_number int,
  content        text,
  is_paid        boolean DEFAULT false,
  updated_at     timestamptz DEFAULT now(),
  UNIQUE (user_id, novel_id, chapter_number)
);

CREATE INDEX IF NOT EXISTS idx_chapter_drafts_user
  ON public.chapter_drafts (user_id, updated_at DESC);

ALTER TABLE public.chapter_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY drafts_self_all
  ON public.chapter_drafts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chapter_drafts TO authenticated;

-- 5. RPC: апрув заявки переводчика (выставляет role, копирует slug в profiles)
CREATE OR REPLACE FUNCTION public.approve_translator_application(
  p_application_id bigint,
  p_note           text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user  uuid;
  v_slug  text;
BEGIN
  -- Только админ
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins can approve applications';
  END IF;

  SELECT user_id, desired_slug
  INTO v_user, v_slug
  FROM public.translator_applications
  WHERE id = p_application_id AND status = 'pending';

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Application not found or already processed';
  END IF;

  UPDATE public.translator_applications
  SET status        = 'approved',
      reviewed_at   = now(),
      reviewer_id   = auth.uid(),
      reviewer_note = p_note
  WHERE id = p_application_id;

  UPDATE public.profiles
  SET role             = 'translator',
      translator_slug  = COALESCE(v_slug, translator_slug)
  WHERE id = v_user;
END $$;

GRANT EXECUTE ON FUNCTION public.approve_translator_application TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_translator_application(
  p_application_id bigint,
  p_note           text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins can reject applications';
  END IF;

  UPDATE public.translator_applications
  SET status        = 'rejected',
      reviewed_at   = now(),
      reviewer_id   = auth.uid(),
      reviewer_note = p_note
  WHERE id = p_application_id AND status = 'pending';
END $$;

GRANT EXECUTE ON FUNCTION public.reject_translator_application TO authenticated;
