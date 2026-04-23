-- ============================================================
-- 032: маркетплейс «Ищу редактора / корректора / бету / …»
--
-- Раньше это делалось в TG-чатах наугад. Теперь доска: переводчик
-- вешает объявление, исполнители откликаются. Рейтинги и отзывы
-- добавим миграцией 033 (отдельный этап, когда UI первой итерации
-- оттестируется).
--
-- Безопасно для tene.fun: новые таблицы и RLS, старого ничего не трогаем.
-- ============================================================

-- ------------------------------------------------------------
-- Роли. Держим как CHECK с текстовым списком — проще добавлять,
-- не нужно делать пляску с enum-миграциями.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketplace_listings (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  author_id        uuid   NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role             text   NOT NULL CHECK (role IN (
    'co_translator',  -- со-переводчик / помощник перевода
    'editor',         -- литературный редактор
    'proofreader',    -- корректор (орфография, пунктуация)
    'beta_reader',    -- бета-ридер, первый читатель
    'illustrator',    -- иллюстратор обложек и вставок
    'designer',       -- дизайнер баннеров / промо
    'typesetter',     -- вёрстка / тайпсет
    'glossary',       -- консультант по именам, терминологии
    'community',      -- комьюнити-менеджер / SMM
    'promo_writer',   -- копирайтер промо-постов
    'other'           -- свободная роль, опишет в тексте
  )),
  title            text   NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
  description      text   NOT NULL CHECK (length(description) BETWEEN 10 AND 3000),
  novel_id         bigint REFERENCES public.novels(id) ON DELETE SET NULL,
  compensation     text   NOT NULL CHECK (compensation IN (
    'revenue_share',  -- % с доходов
    'per_chapter',    -- монеты или ₽ за главу
    'fixed',          -- фиксированная сумма за проект
    'exchange',       -- бартер (портфолио, упоминание)
    'volunteer'       -- волонтёрская основа
  )),
  compensation_note text  CHECK (compensation_note IS NULL OR length(compensation_note) <= 300),
  status           text   NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'in_progress', 'closed')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz
);

CREATE INDEX IF NOT EXISTS idx_listings_role_status
  ON public.marketplace_listings (role, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_author
  ON public.marketplace_listings (author_id, created_at DESC);

ALTER TABLE public.marketplace_listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS listings_read_all    ON public.marketplace_listings;
DROP POLICY IF EXISTS listings_owner_all   ON public.marketplace_listings;
DROP POLICY IF EXISTS listings_admin_all   ON public.marketplace_listings;

-- Все могут читать (доска публичная)
CREATE POLICY listings_read_all
  ON public.marketplace_listings FOR SELECT
  USING (true);

-- Автор управляет своим объявлением
CREATE POLICY listings_owner_all
  ON public.marketplace_listings FOR ALL
  USING (auth.uid() = author_id)
  WITH CHECK (auth.uid() = author_id);

-- Админ — всё
CREATE POLICY listings_admin_all
  ON public.marketplace_listings FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = true OR role = 'admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = true OR role = 'admin')
  ));

GRANT SELECT                        ON public.marketplace_listings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_listings TO authenticated;

-- Триггер updated_at
CREATE OR REPLACE FUNCTION public.trg_listing_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status = 'closed' AND (OLD.status IS DISTINCT FROM 'closed') THEN
    NEW.closed_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS listings_touch ON public.marketplace_listings;
CREATE TRIGGER listings_touch
  BEFORE UPDATE ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.trg_listing_touch();

-- ------------------------------------------------------------
-- Отклики на объявление
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketplace_applications (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  listing_id   bigint NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  applicant_id uuid   NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message      text   CHECK (message IS NULL OR length(message) <= 1500),
  status       text   NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn')),
  portfolio_url text  CHECK (portfolio_url IS NULL OR length(portfolio_url) <= 500),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, applicant_id)
);

CREATE INDEX IF NOT EXISTS idx_applications_listing
  ON public.marketplace_applications (listing_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_applications_applicant
  ON public.marketplace_applications (applicant_id, created_at DESC);

ALTER TABLE public.marketplace_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS apps_self_read         ON public.marketplace_applications;
DROP POLICY IF EXISTS apps_owner_read        ON public.marketplace_applications;
DROP POLICY IF EXISTS apps_self_insert       ON public.marketplace_applications;
DROP POLICY IF EXISTS apps_self_update       ON public.marketplace_applications;
DROP POLICY IF EXISTS apps_owner_update      ON public.marketplace_applications;
DROP POLICY IF EXISTS apps_admin_all         ON public.marketplace_applications;

-- Исполнитель видит свои отклики
CREATE POLICY apps_self_read
  ON public.marketplace_applications FOR SELECT
  USING (auth.uid() = applicant_id);

-- Автор объявления видит отклики на своё объявление
CREATE POLICY apps_owner_read
  ON public.marketplace_applications FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.marketplace_listings l
    WHERE l.id = listing_id AND l.author_id = auth.uid()
  ));

-- Исполнитель откликается: может вставить, только если он НЕ автор листинга
-- (запрещено откликаться на собственное объявление).
CREATE POLICY apps_self_insert
  ON public.marketplace_applications FOR INSERT
  WITH CHECK (
    auth.uid() = applicant_id
    AND NOT EXISTS (
      SELECT 1 FROM public.marketplace_listings l
      WHERE l.id = listing_id AND l.author_id = auth.uid()
    )
  );

-- Исполнитель может менять status свой (только в withdrawn) и message
CREATE POLICY apps_self_update
  ON public.marketplace_applications FOR UPDATE
  USING (auth.uid() = applicant_id)
  WITH CHECK (auth.uid() = applicant_id);

-- Автор листинга может менять status (accepted/declined)
CREATE POLICY apps_owner_update
  ON public.marketplace_applications FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.marketplace_listings l
    WHERE l.id = listing_id AND l.author_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.marketplace_listings l
    WHERE l.id = listing_id AND l.author_id = auth.uid()
  ));

-- Админ — всё
CREATE POLICY apps_admin_all
  ON public.marketplace_applications FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = true OR role = 'admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = true OR role = 'admin')
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_applications TO authenticated;

-- Триггер updated_at
CREATE OR REPLACE FUNCTION public.trg_application_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS applications_touch ON public.marketplace_applications;
CREATE TRIGGER applications_touch
  BEFORE UPDATE ON public.marketplace_applications
  FOR EACH ROW EXECUTE FUNCTION public.trg_application_touch();

-- ------------------------------------------------------------
-- View для публичной ленты: листинг + имя/аватар автора + кол-во откликов.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.marketplace_listings_view AS
SELECT
  l.id,
  l.author_id,
  l.role,
  l.title,
  l.description,
  l.novel_id,
  l.compensation,
  l.compensation_note,
  l.status,
  l.created_at,
  l.updated_at,
  l.closed_at,
  p.user_name         AS author_name,
  p.avatar_url        AS author_avatar,
  p.translator_slug   AS author_slug,
  n.title             AS novel_title,
  n.firebase_id       AS novel_firebase_id,
  (
    SELECT COUNT(*)::int FROM public.marketplace_applications a
    WHERE a.listing_id = l.id AND a.status IN ('pending', 'accepted')
  ) AS application_count
FROM public.marketplace_listings l
LEFT JOIN public.profiles p ON p.id = l.author_id
LEFT JOIN public.novels   n ON n.id = l.novel_id;

ALTER VIEW public.marketplace_listings_view OWNER TO supabase_admin;
GRANT SELECT ON public.marketplace_listings_view TO anon, authenticated;

-- View для откликов с данными заявителя (видит только автор листинга
-- и сам заявитель — RLS на базовой таблице отрабатывает автоматически).
CREATE OR REPLACE VIEW public.marketplace_applications_view AS
SELECT
  a.id,
  a.listing_id,
  a.applicant_id,
  a.message,
  a.status,
  a.portfolio_url,
  a.created_at,
  a.updated_at,
  p.user_name       AS applicant_name,
  p.avatar_url      AS applicant_avatar,
  p.translator_slug AS applicant_slug
FROM public.marketplace_applications a
LEFT JOIN public.profiles p ON p.id = a.applicant_id;

ALTER VIEW public.marketplace_applications_view OWNER TO supabase_admin;
GRANT SELECT ON public.marketplace_applications_view TO authenticated;
