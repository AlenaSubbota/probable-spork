-- ============================================================
-- Миграция 009: новости/объявления от админа
-- Зависит от 001 (role), 004 (translator_applications — как образец для RLS).
-- Безопасно для tene.fun: новая таблица, не трогает существующие.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.news_posts (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  author_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  title          text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
  body           text NOT NULL,        -- HTML (от BB-редактора)
  type           text NOT NULL DEFAULT 'announcement'
    CHECK (type IN ('announcement', 'event', 'update', 'tip', 'maintenance')),
  is_pinned      boolean NOT NULL DEFAULT false,
  is_published   boolean NOT NULL DEFAULT true,
  attached_novel_id bigint REFERENCES public.novels(id) ON DELETE SET NULL,
  created_at     timestamptz DEFAULT now(),
  published_at   timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_news_posts_pub
  ON public.news_posts (is_published, is_pinned DESC, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_news_posts_novel
  ON public.news_posts (attached_novel_id)
  WHERE attached_novel_id IS NOT NULL;

-- RLS
ALTER TABLE public.news_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS news_read_all   ON public.news_posts;
DROP POLICY IF EXISTS news_admin_all  ON public.news_posts;

-- Читать опубликованные может любой; черновики — только админ
CREATE POLICY news_read_all
  ON public.news_posts FOR SELECT
  USING (
    is_published = true
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (is_admin = true OR role = 'admin')
    )
  );

-- INSERT / UPDATE / DELETE — только админ
CREATE POLICY news_admin_all
  ON public.news_posts FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (is_admin = true OR role = 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (is_admin = true OR role = 'admin')
    )
  );

GRANT SELECT                         ON public.news_posts TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE         ON public.news_posts TO authenticated;

-- Триггер: updated_at
CREATE OR REPLACE FUNCTION public.trg_news_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS news_updated_at_tg ON public.news_posts;
CREATE TRIGGER news_updated_at_tg
  BEFORE UPDATE ON public.news_posts
  FOR EACH ROW EXECUTE FUNCTION public.trg_news_updated_at();

-- RPC: отметить новости прочитанными (через profiles.settings jsonb, чтобы не плодить таблицы)
CREATE OR REPLACE FUNCTION public.mark_news_seen(p_max_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current bigint;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;

  SELECT COALESCE((settings ->> 'news_seen_max_id')::bigint, 0)
  INTO v_current
  FROM public.profiles WHERE id = auth.uid();

  IF p_max_id > COALESCE(v_current, 0) THEN
    -- Обходим RLS через SECURITY DEFINER
    UPDATE public.profiles
    SET settings = COALESCE(settings, '{}'::jsonb)
                 || jsonb_build_object('news_seen_max_id', p_max_id)
    WHERE id = auth.uid();
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.mark_news_seen TO authenticated;

-- RPC: счётчик непрочитанных новостей для текущего пользователя
CREATE OR REPLACE FUNCTION public.unread_news_count()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COUNT(*)::int
  FROM public.news_posts np
  WHERE np.is_published = true
    AND np.id > COALESCE(
      (SELECT (settings ->> 'news_seen_max_id')::bigint
       FROM public.profiles WHERE id = auth.uid()),
      0
    );
$$;

GRANT EXECUTE ON FUNCTION public.unread_news_count TO authenticated;

-- Триггер: при публикации новости с привязанной новеллой — создать notifications
-- для всех, у кого новелла в закладках. Отключён по умолчанию, чтобы не спамить;
-- включать когда будет явная галочка «уведомить читателей полки» в UI.
-- Пока не накатываем — оставлено для справки.
