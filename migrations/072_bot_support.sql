-- ============================================================
-- 072: канал поддержки через Telegram-бот
--
-- /rules, /contacts, /help ссылаются на @chaptifybot как на главный
-- канал поддержки. До этой миграции хранилища обращений
-- не было — всё терялось в истории админ-чата. Сейчас вводим журнал.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.chaptify_bot_support_messages (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  chat_id         bigint NOT NULL,
  category        text NOT NULL CHECK (
    category IN ('payment','bug','appeal','user_report','content_report','other')
  ),
  body            text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  ref_kind        text CHECK (ref_kind IS NULL OR ref_kind IN ('comment','novel','quote','user','chapter')),
  ref_id          text,
  status          text NOT NULL DEFAULT 'open' CHECK (
    status IN ('open','answered','resolved','closed','spam')
  ),
  admin_reply       text CHECK (admin_reply IS NULL OR length(admin_reply) <= 4000),
  admin_reply_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  admin_replied_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_bot_support_status_created
  ON public.chaptify_bot_support_messages (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_support_user_created
  ON public.chaptify_bot_support_messages (user_id, created_at DESC);

ALTER TABLE public.chaptify_bot_support_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bot_support_self_select ON public.chaptify_bot_support_messages;
DROP POLICY IF EXISTS bot_support_admin_all   ON public.chaptify_bot_support_messages;

-- Сам пользователь видит свои сообщения
CREATE POLICY bot_support_self_select
  ON public.chaptify_bot_support_messages FOR SELECT
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- Админ видит/правит всё
CREATE POLICY bot_support_admin_all
  ON public.chaptify_bot_support_messages FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (role = 'admin' OR COALESCE(is_admin, false) = true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (role = 'admin' OR COALESCE(is_admin, false) = true)
  ));

GRANT SELECT ON public.chaptify_bot_support_messages TO authenticated;

-- ------------------------------------------------------------
-- RPC submit_bot_support: бот вызывает от имени юзера (service_role).
-- Rate-limit: не более 5 открытых тикетов одновременно.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_bot_support(
  p_user_id   uuid,
  p_chat_id   bigint,
  p_category  text,
  p_body      text,
  p_ref_kind  text DEFAULT NULL,
  p_ref_id    text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_open_cnt int;
  v_id       bigint;
  v_clean    text := btrim(COALESCE(p_body, ''));
BEGIN
  IF p_chat_id IS NULL THEN RAISE EXCEPTION 'chat_id required'; END IF;
  IF p_category NOT IN ('payment','bug','appeal','user_report','content_report','other') THEN
    RAISE EXCEPTION 'unknown category %', p_category;
  END IF;
  IF char_length(v_clean) < 1 OR char_length(v_clean) > 4000 THEN
    RAISE EXCEPTION 'body must be 1..4000 chars';
  END IF;

  IF p_user_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_open_cnt
    FROM public.chaptify_bot_support_messages
    WHERE user_id = p_user_id AND status IN ('open', 'answered');
    IF v_open_cnt >= 5 THEN
      RAISE EXCEPTION 'too many open tickets, wait for resolution';
    END IF;
  END IF;

  INSERT INTO public.chaptify_bot_support_messages
    (user_id, chat_id, category, body, ref_kind, ref_id)
  VALUES
    (p_user_id, p_chat_id, p_category, v_clean,
     NULLIF(btrim(COALESCE(p_ref_kind, '')), ''),
     NULLIF(btrim(COALESCE(p_ref_id,   '')), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.submit_bot_support(uuid, bigint, text, text, text, text)
  TO service_role;

-- ------------------------------------------------------------
-- RPC list_pending_bot_support — для админ-панели. Только админ.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_pending_bot_support(p_limit int DEFAULT 30)
RETURNS TABLE (
  id bigint, user_id uuid, user_name text, chat_id bigint,
  category text, body text, ref_kind text, ref_id text,
  status text, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_admin boolean;
BEGIN
  SELECT (role = 'admin' OR COALESCE(is_admin, false) = true)
  INTO v_admin FROM public.profiles WHERE id = auth.uid();
  IF NOT COALESCE(v_admin, false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT m.id, m.user_id, COALESCE(p.user_name, '—'),
         m.chat_id, m.category, m.body, m.ref_kind, m.ref_id,
         m.status, m.created_at
  FROM public.chaptify_bot_support_messages m
  LEFT JOIN public.profiles p ON p.id = m.user_id
  WHERE m.status IN ('open', 'answered')
  ORDER BY m.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
END $$;

GRANT EXECUTE ON FUNCTION public.list_pending_bot_support(int)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- RPC mark_bot_support — бот /reply вызывает для закрытия тикета.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_bot_support(
  p_id         bigint,
  p_status     text,
  p_reply      text DEFAULT NULL,
  p_admin_id   uuid DEFAULT NULL
) RETURNS public.chaptify_bot_support_messages
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_row public.chaptify_bot_support_messages%ROWTYPE;
BEGIN
  IF p_status NOT IN ('open','answered','resolved','closed','spam') THEN
    RAISE EXCEPTION 'unknown status %', p_status;
  END IF;

  UPDATE public.chaptify_bot_support_messages
  SET status = p_status,
      admin_reply = COALESCE(NULLIF(btrim(COALESCE(p_reply, '')), ''), admin_reply),
      admin_reply_by = COALESCE(p_admin_id, admin_reply_by),
      admin_replied_at = CASE WHEN p_reply IS NOT NULL THEN now() ELSE admin_replied_at END,
      resolved_at = CASE WHEN p_status IN ('resolved','closed','spam') THEN now() ELSE resolved_at END
  WHERE id = p_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'support ticket % not found', p_id;
  END IF;

  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION public.mark_bot_support(bigint, text, text, uuid)
  TO service_role;
