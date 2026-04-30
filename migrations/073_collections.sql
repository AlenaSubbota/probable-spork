-- =====================================================================
-- 073_collections: пользовательские подборки новелл
-- ---------------------------------------------------------------------
-- Подборки — это курируемые наборы новелл. Раньше существовали только
-- статически в коде (lib/collections.ts). Теперь переводчики и админы
-- могут собирать и редактировать собственные подборки в БД, публикуя
-- их на сайте. Админ дополнительно может «припинить» подборку на
-- главную через is_featured.
--
-- Ограничения:
-- * INSERT — только translator/admin (роль из profiles).
-- * UPDATE/DELETE — владелец или админ.
-- * is_featured может менять только админ (BEFORE-триггер откатывает
--   попытки переводчика изменить этот флаг).
-- * SELECT — публикация (is_published=true) видна всем; черновики
--   видит только владелец и админ.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.collections (
  id            bigserial PRIMARY KEY,
  slug          text NOT NULL UNIQUE
                CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  title         text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  tagline       text CHECK (tagline IS NULL OR length(tagline) <= 240),
  description   text CHECK (description IS NULL OR length(description) <= 4000),
  emoji         text DEFAULT '✦' CHECK (length(emoji) BETWEEN 1 AND 8),
  owner_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Массив firebase_id новелл, в порядке отображения. Ограничиваем
  -- размером 200 — это и так с большим запасом для подборки.
  novel_ids     jsonb NOT NULL DEFAULT '[]'::jsonb
                CHECK (jsonb_typeof(novel_ids) = 'array'
                       AND jsonb_array_length(novel_ids) <= 200),
  is_published  boolean NOT NULL DEFAULT false,
  is_featured   boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS collections_owner_idx
  ON public.collections (owner_id);
CREATE INDEX IF NOT EXISTS collections_published_idx
  ON public.collections (is_published)
  WHERE is_published = true;
CREATE INDEX IF NOT EXISTS collections_featured_idx
  ON public.collections (is_featured)
  WHERE is_featured = true AND is_published = true;

-- updated_at — общий шаблон проекта.
CREATE OR REPLACE FUNCTION public.touch_collections_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collections_touch_updated_at ON public.collections;
CREATE TRIGGER collections_touch_updated_at
  BEFORE UPDATE ON public.collections
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_collections_updated_at();

-- Защита is_featured: переводчик не может «припинить» свою подборку
-- на главную. RLS WITH CHECK не имеет доступа к OLD-строке, поэтому
-- проверяем в BEFORE-триггере. Если юзер не админ — откатываем поле
-- к старому значению.
CREATE OR REPLACE FUNCTION public.collections_protect_featured()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  is_admin_user boolean := false;
BEGIN
  IF NEW.is_featured IS DISTINCT FROM OLD.is_featured THEN
    SELECT (p.is_admin = true OR p.role = 'admin')
      INTO is_admin_user
      FROM public.profiles p
     WHERE p.id = auth.uid();
    IF NOT COALESCE(is_admin_user, false) THEN
      NEW.is_featured := OLD.is_featured;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collections_protect_featured ON public.collections;
CREATE TRIGGER collections_protect_featured
  BEFORE UPDATE ON public.collections
  FOR EACH ROW
  EXECUTE FUNCTION public.collections_protect_featured();

-- Аналогично для INSERT: переводчик не может сразу создать featured.
CREATE OR REPLACE FUNCTION public.collections_protect_featured_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  is_admin_user boolean := false;
BEGIN
  IF NEW.is_featured = true THEN
    SELECT (p.is_admin = true OR p.role = 'admin')
      INTO is_admin_user
      FROM public.profiles p
     WHERE p.id = auth.uid();
    IF NOT COALESCE(is_admin_user, false) THEN
      NEW.is_featured := false;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collections_protect_featured_insert ON public.collections;
CREATE TRIGGER collections_protect_featured_insert
  BEFORE INSERT ON public.collections
  FOR EACH ROW
  EXECUTE FUNCTION public.collections_protect_featured_insert();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------

ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;

-- Публикации видят все (включая анонимов).
DROP POLICY IF EXISTS collections_read_published ON public.collections;
CREATE POLICY collections_read_published
  ON public.collections
  FOR SELECT
  USING (is_published = true);

-- Свои черновики видит автор.
DROP POLICY IF EXISTS collections_read_own ON public.collections;
CREATE POLICY collections_read_own
  ON public.collections
  FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());

-- Админ видит всё.
DROP POLICY IF EXISTS collections_read_admin ON public.collections;
CREATE POLICY collections_read_admin
  ON public.collections
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid() AND (p.is_admin = true OR p.role = 'admin')
  ));

-- INSERT: только translator/admin, и только себе как owner_id.
DROP POLICY IF EXISTS collections_insert ON public.collections;
CREATE POLICY collections_insert
  ON public.collections
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid()
         AND (p.is_admin = true OR p.role IN ('admin','translator'))
    )
  );

-- UPDATE владельца — только своя строка. is_featured защищает
-- триггер выше (откатит изменение, если автор не админ).
DROP POLICY IF EXISTS collections_update_own ON public.collections;
CREATE POLICY collections_update_own
  ON public.collections
  FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- UPDATE админа — любая строка.
DROP POLICY IF EXISTS collections_update_admin ON public.collections;
CREATE POLICY collections_update_admin
  ON public.collections
  FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid() AND (p.is_admin = true OR p.role = 'admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid() AND (p.is_admin = true OR p.role = 'admin')
  ));

-- DELETE: владелец или админ.
DROP POLICY IF EXISTS collections_delete ON public.collections;
CREATE POLICY collections_delete
  ON public.collections
  FOR DELETE
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid() AND (p.is_admin = true OR p.role = 'admin')
    )
  );
