-- ============================================================
-- 034: несколько переводчиков и ролей в новелле + фикс can_read_chapter
-- для переводчиков.
--
-- Задачи:
--  A) Поддержать несколько человек на одной новелле (переводчик +
--     редактор + корректор + иллюстратор и т.п.). Каждый получает
--     долю в будущих выплатах (share_percent).
--  B) Переводчик (и все члены команды) должны читать платные главы
--     своей новеллы бесплатно — они сами их делают. Сейчас they
--     проваливаются на paywall.
--
-- Роли те же, что в маркетплейсе — чтобы было единообразно.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.novel_translators (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  novel_id       bigint NOT NULL REFERENCES public.novels(id)     ON DELETE CASCADE,
  user_id        uuid   NOT NULL REFERENCES public.profiles(id)   ON DELETE CASCADE,
  role           text   NOT NULL CHECK (role IN (
    'translator',     -- основной переводчик
    'co_translator',  -- со-переводчик
    'editor',
    'proofreader',
    'beta_reader',
    'illustrator',
    'designer',
    'typesetter',
    'glossary',
    'community',
    'promo_writer',
    'other'
  )),
  share_percent  numeric(5,2) NOT NULL DEFAULT 0 CHECK (share_percent BETWEEN 0 AND 100),
  note           text   CHECK (note IS NULL OR length(note) <= 200),
  sort_order     int    NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (novel_id, user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_novel_translators_novel ON public.novel_translators (novel_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_novel_translators_user  ON public.novel_translators (user_id);

-- Backfill: для каждой новеллы с translator_id — одна запись role='translator' 100%
INSERT INTO public.novel_translators (novel_id, user_id, role, share_percent, sort_order)
SELECT n.id, n.translator_id, 'translator', 100, 0
FROM public.novels n
WHERE n.translator_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE public.novel_translators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nt_read_all       ON public.novel_translators;
DROP POLICY IF EXISTS nt_owner_all      ON public.novel_translators;
DROP POLICY IF EXISTS nt_admin_all      ON public.novel_translators;

-- Все могут читать (кто в команде новеллы — публичная инфа)
CREATE POLICY nt_read_all
  ON public.novel_translators FOR SELECT
  USING (true);

-- Автор новеллы (основной переводчик) может управлять командой
CREATE POLICY nt_owner_all
  ON public.novel_translators FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.novels
    WHERE id = novel_id AND translator_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.novels
    WHERE id = novel_id AND translator_id = auth.uid()
  ));

CREATE POLICY nt_admin_all
  ON public.novel_translators FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = true OR role = 'admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = true OR role = 'admin')
  ));

GRANT SELECT                        ON public.novel_translators TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.novel_translators TO authenticated;

-- View с именами/аватарами для рендера на странице новеллы
CREATE OR REPLACE VIEW public.novel_credits AS
SELECT
  nt.id,
  nt.novel_id,
  nt.user_id,
  nt.role,
  nt.share_percent,
  nt.note,
  nt.sort_order,
  p.user_name        AS user_name,
  p.avatar_url       AS avatar_url,
  p.translator_slug  AS translator_slug,
  p.translator_display_name AS display_name
FROM public.novel_translators nt
LEFT JOIN public.profiles p ON p.id = nt.user_id;

ALTER VIEW public.novel_credits OWNER TO supabase_admin;
GRANT SELECT ON public.novel_credits TO anon, authenticated;

-- ============================================================
-- can_read_chapter: теперь пропускает ВСЕХ членов команды
-- ============================================================
CREATE OR REPLACE FUNCTION public.can_read_chapter(
  p_user    uuid,
  p_novel   bigint,
  p_chapter int
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_is_paid      boolean;
  v_translator   uuid;
  v_early_until  timestamptz;
  v_is_team      boolean := false;
  v_is_admin     boolean := false;
BEGIN
  SELECT c.is_paid, n.translator_id, c.early_access_until
  INTO v_is_paid, v_translator, v_early_until
  FROM public.chapters c
  JOIN public.novels   n ON n.id = c.novel_id
  WHERE c.novel_id = p_novel AND c.chapter_number = p_chapter
  LIMIT 1;

  -- Команда новеллы читает бесплатно (включая основного переводчика)
  IF p_user IS NOT NULL THEN
    IF p_user = v_translator THEN
      v_is_team := true;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.novel_translators
        WHERE novel_id = p_novel AND user_id = p_user
      ) INTO v_is_team;
    END IF;

    SELECT (is_admin = true OR role = 'admin')
    INTO v_is_admin
    FROM public.profiles WHERE id = p_user;
  END IF;

  IF v_is_team OR v_is_admin THEN RETURN true; END IF;

  -- Ранний доступ: пока период не истёк, читают только подписчики и купившие
  IF v_early_until IS NOT NULL AND v_early_until > now() THEN
    IF EXISTS (
      SELECT 1 FROM public.subscriptions
      WHERE user_id = p_user AND translator_id = v_translator
        AND status = 'active' AND (expires_at IS NULL OR expires_at > now())
    ) THEN RETURN true; END IF;
    IF EXISTS (
      SELECT 1 FROM public.chapter_purchases
      WHERE user_id = p_user AND novel_id = p_novel AND chapter_number = p_chapter
    ) THEN RETURN true; END IF;
    RETURN false;
  END IF;

  IF NOT v_is_paid THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id       = p_user
      AND translator_id = v_translator
      AND status        = 'active'
      AND (expires_at IS NULL OR expires_at > now())
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.chapter_purchases
    WHERE user_id        = p_user
      AND novel_id       = p_novel
      AND chapter_number = p_chapter
  ) THEN RETURN true; END IF;

  RETURN false;
END $$;

GRANT EXECUTE ON FUNCTION public.can_read_chapter(uuid, bigint, int) TO authenticated, anon;
