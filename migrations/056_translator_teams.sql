-- ============================================================
-- 056: команды переводчиков как первоклассная сущность
--
-- Модель: переводчик — больше не «одиночка с привязанной новеллой».
-- Теперь у новеллы может быть КОМАНДА (translator_teams), внутри неё —
-- участники с ролями (team_members). Читатель видит «Перевод команды
-- N»; в команду заходишь и видишь всех участников + общие способы
-- оплаты. Это решает старую боль «кому донатить, если переводчиков 20»
-- — деньги идут на счёт ВЛАДЕЛЬЦА команды (это его внешние Boosty/
-- Tribute/...), а делит сам.
--
-- Совместимость:
--   - novels.translator_id остаётся как было (это юзер-владелец).
--     Tene, который читает старую модель, не ломается.
--   - novels.team_id — новая опциональная колонка. Если NULL,
--     поведение прежнее (показываем translator-одиночку). Если есть —
--     заменяет «переведено N» в UI на «команда X».
--   - translator_payment_methods — НЕ переносим. Лидер команды
--     настраивает свои payment_methods, и они работают как методы
--     команды (фронт ходит за payment_methods владельца команды).
--   - novel_translators (миграция 034) остаётся как «команда новеллы»
--     legacy-уровня. Новые команды поверх неё. Команда → имеет
--     novel'ы; novel_translators хранит детали ролей по конкретной
--     новелле, если нужны.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.translator_teams (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug            text   NOT NULL UNIQUE
                  CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name            text   NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  description     text   CHECK (description IS NULL OR length(description) <= 1000),
  avatar_url      text   CHECK (avatar_url IS NULL OR length(avatar_url) <= 500),
  banner_url      text   CHECK (banner_url IS NULL OR length(banner_url) <= 500),
  owner_id        uuid   NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  accepts_coins_for_chapters boolean NOT NULL DEFAULT true,
  is_archived     boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_translator_teams_owner
  ON public.translator_teams (owner_id) WHERE NOT is_archived;

CREATE TABLE IF NOT EXISTS public.team_members (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id       bigint NOT NULL REFERENCES public.translator_teams(id) ON DELETE CASCADE,
  user_id       uuid   NOT NULL REFERENCES public.profiles(id)         ON DELETE CASCADE,
  role          text   NOT NULL DEFAULT 'co_translator' CHECK (role IN (
    'lead',           -- лидер (= owner, ровно один)
    'translator',
    'co_translator',
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
  share_percent numeric(5,2) NOT NULL DEFAULT 0
                CHECK (share_percent BETWEEN 0 AND 100),
  note          text   CHECK (note IS NULL OR length(note) <= 200),
  sort_order    int    NOT NULL DEFAULT 0,
  joined_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_team
  ON public.team_members (team_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_team_members_user
  ON public.team_members (user_id);

-- Новеллы могут принадлежать команде. translator_id — кто завёл, как
-- было. team_id — кто переводит как коллектив. UI показывает team если
-- есть, иначе fallback на translator.
ALTER TABLE public.novels
  ADD COLUMN IF NOT EXISTS team_id bigint
  REFERENCES public.translator_teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_novels_team
  ON public.novels (team_id) WHERE team_id IS NOT NULL;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.translator_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tt_read_all   ON public.translator_teams;
DROP POLICY IF EXISTS tt_owner_all  ON public.translator_teams;
DROP POLICY IF EXISTS tt_admin_all  ON public.translator_teams;

-- Команды публичны: профиль команды должен открываться даже анонимам
CREATE POLICY tt_read_all
  ON public.translator_teams FOR SELECT
  USING (true);

CREATE POLICY tt_owner_all
  ON public.translator_teams FOR ALL
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY tt_admin_all
  ON public.translator_teams FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = true OR role = 'admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = true OR role = 'admin')
  ));

DROP POLICY IF EXISTS tm_read_all      ON public.team_members;
DROP POLICY IF EXISTS tm_self_leave    ON public.team_members;
DROP POLICY IF EXISTS tm_owner_all     ON public.team_members;
DROP POLICY IF EXISTS tm_admin_all     ON public.team_members;

-- Состав команды публичен
CREATE POLICY tm_read_all
  ON public.team_members FOR SELECT
  USING (true);

-- Юзер может удалить себя из команды (выйти)
CREATE POLICY tm_self_leave
  ON public.team_members FOR DELETE
  USING (auth.uid() = user_id);

-- Лидер команды управляет участниками
CREATE POLICY tm_owner_all
  ON public.team_members FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.translator_teams t
    WHERE t.id = team_id AND t.owner_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.translator_teams t
    WHERE t.id = team_id AND t.owner_id = auth.uid()
  ));

CREATE POLICY tm_admin_all
  ON public.team_members FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = true OR role = 'admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = true OR role = 'admin')
  ));

GRANT SELECT                         ON public.translator_teams TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.translator_teams TO authenticated;
GRANT SELECT                         ON public.team_members     TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_members     TO authenticated;

-- ============================================================
-- View team_view: команда + список участников с avatar/name (для рендера)
-- ============================================================
CREATE OR REPLACE VIEW public.team_view AS
SELECT
  t.id,
  t.slug,
  t.name,
  t.description,
  t.avatar_url,
  t.banner_url,
  t.owner_id,
  t.accepts_coins_for_chapters,
  t.is_archived,
  t.created_at,
  t.updated_at,
  -- Имя владельца — для подписи «лидер»
  po.user_name              AS owner_user_name,
  po.translator_display_name AS owner_display_name,
  po.avatar_url             AS owner_avatar_url,
  po.translator_slug        AS owner_translator_slug,
  -- Кол-во новелл и участников — для шапки команды
  (SELECT count(*) FROM public.novels WHERE team_id = t.id) AS novel_count,
  (SELECT count(*) FROM public.team_members WHERE team_id = t.id) AS member_count
FROM public.translator_teams t
LEFT JOIN public.profiles po ON po.id = t.owner_id;

ALTER VIEW public.team_view OWNER TO supabase_admin;
GRANT SELECT ON public.team_view TO anon, authenticated;

-- View team_members_view: список участников с профилями
CREATE OR REPLACE VIEW public.team_members_view AS
SELECT
  tm.id,
  tm.team_id,
  tm.user_id,
  tm.role,
  tm.share_percent,
  tm.note,
  tm.sort_order,
  tm.joined_at,
  p.user_name,
  p.translator_display_name,
  p.translator_slug,
  p.avatar_url,
  p.translator_about
FROM public.team_members tm
LEFT JOIN public.profiles p ON p.id = tm.user_id
ORDER BY tm.sort_order ASC, tm.joined_at ASC;

ALTER VIEW public.team_members_view OWNER TO supabase_admin;
GRANT SELECT ON public.team_members_view TO anon, authenticated;

-- ============================================================
-- RPC: создать команду + сразу записать создателя как lead-участника.
-- Атомарно — иначе после INSERT в translator_teams юзер мог остаться без
-- членства и не пройти tm_owner_all (хотя tm_self_leave его прибивает).
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_my_team(
  p_slug        text,
  p_name        text,
  p_description text DEFAULT NULL,
  p_avatar_url  text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_team_id   bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  INSERT INTO public.translator_teams (slug, name, description, avatar_url, owner_id)
  VALUES (p_slug, p_name, NULLIF(btrim(p_description), ''), p_avatar_url, v_uid)
  RETURNING id INTO v_team_id;

  INSERT INTO public.team_members (team_id, user_id, role, share_percent, sort_order)
  VALUES (v_team_id, v_uid, 'lead', 100, 0);

  RETURN v_team_id;
END $$;

GRANT EXECUTE ON FUNCTION public.create_my_team(text, text, text, text) TO authenticated;

-- ============================================================
-- RPC: пригласить пользователя в команду по slug или user_name.
-- Только лидер может звать. Возвращает id записи team_members.
-- ============================================================
CREATE OR REPLACE FUNCTION public.invite_to_my_team(
  p_team_id      bigint,
  p_user_handle  text,            -- translator_slug или user_name
  p_role         text DEFAULT 'co_translator',
  p_share_percent numeric DEFAULT 0
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_owner_id  uuid;
  v_user_id   uuid;
  v_member_id bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT owner_id INTO v_owner_id FROM public.translator_teams WHERE id = p_team_id;
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'team not found';
  END IF;
  IF v_owner_id <> v_uid THEN
    RAISE EXCEPTION 'only team owner can invite';
  END IF;

  SELECT id INTO v_user_id
  FROM public.profiles
  WHERE translator_slug = p_user_handle OR user_name = p_user_handle
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'user not found: %', p_user_handle;
  END IF;

  INSERT INTO public.team_members (team_id, user_id, role, share_percent)
  VALUES (p_team_id, v_user_id, p_role, p_share_percent)
  ON CONFLICT (team_id, user_id) DO UPDATE
    SET role = EXCLUDED.role,
        share_percent = EXCLUDED.share_percent
  RETURNING id INTO v_member_id;

  RETURN v_member_id;
END $$;

GRANT EXECUTE ON FUNCTION public.invite_to_my_team(bigint, text, text, numeric) TO authenticated;

-- ============================================================
-- updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.touch_translator_team_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_translator_teams_updated_at ON public.translator_teams;
CREATE TRIGGER trg_translator_teams_updated_at
  BEFORE UPDATE ON public.translator_teams
  FOR EACH ROW EXECUTE FUNCTION public.touch_translator_team_updated_at();

-- ============================================================
-- novels_view: добавляем team_id, чтобы фронт мог в одном запросе
-- получить новеллу + сразу понять, что она в команде. Структура та же,
-- что в 046_multiple_covers — просто плюс одна колонка.
-- ============================================================
DROP VIEW IF EXISTS public.novels_view;

CREATE VIEW public.novels_view AS
 SELECT n.id,
    n.firebase_id,
    n.title,
    n.title_original,
    n.title_en,
    n.author,
    n.author_original,
    n.author_en,
    n.description,
    n.cover_url,
    n.covers,
    n.genres,
    n.latest_chapter_published_at,
    n.is_completed,
    n.epub_path,
    n.translator_id,
    n.team_id,                    -- NEW
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
    n.external_links,
    COALESCE(s.average_rating, (0)::numeric) AS average_rating,
    COALESCE(s.rating_count, 0) AS rating_count,
    COALESCE(s.views, 0) AS views,
    COALESCE(c.chapter_count, 0) AS chapter_count,
    COALESCE(c.last_chapter_at, n.latest_chapter_published_at) AS last_chapter_at
   FROM ((public.novels n
     LEFT JOIN public.novel_stats s ON ((s.novel_id = n.id)))
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS chapter_count,
            max(chapters.published_at) AS last_chapter_at
           FROM public.chapters
          WHERE (chapters.novel_id = n.id)) c ON (true));

ALTER VIEW public.novels_view OWNER TO supabase_admin;
GRANT SELECT ON public.novels_view TO anon, authenticated;
