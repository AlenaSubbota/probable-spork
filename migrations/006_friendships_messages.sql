-- ============================================================
-- Миграция 006: дружба и личные сообщения
-- Зависит от 001 (profiles.user_name, role и т.п.)
-- Безопасно для tene.fun: только новые таблицы и RPC.
-- ============================================================

-- 1. Дружба
CREATE TABLE IF NOT EXISTS public.friendships (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  requester_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'blocked')),
  created_at    timestamptz DEFAULT now(),
  decided_at    timestamptz,
  CONSTRAINT friendships_distinct CHECK (requester_id <> addressee_id)
);

-- Только одна активная пара «req → addr» (кейсы declined можно создавать заново? — нет, просто не шлём повторно)
CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_unique
  ON public.friendships (requester_id, addressee_id);

CREATE INDEX IF NOT EXISTS idx_friendships_addressee
  ON public.friendships (addressee_id, status);

CREATE INDEX IF NOT EXISTS idx_friendships_requester
  ON public.friendships (requester_id, status);

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS friendships_read ON public.friendships;

CREATE POLICY friendships_read
  ON public.friendships FOR SELECT
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

-- INSERT / UPDATE / DELETE — только через security-definer RPC (ниже)

GRANT SELECT ON public.friendships TO authenticated;

-- 2. Личные сообщения
CREATE TABLE IF NOT EXISTS public.direct_messages (
  id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sender_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text                      text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 4000),
  attached_novel_id         bigint REFERENCES public.novels(id) ON DELETE SET NULL,
  attached_chapter_number   integer,
  created_at                timestamptz DEFAULT now(),
  read_at                   timestamptz,
  CONSTRAINT direct_messages_distinct CHECK (sender_id <> recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_pair
  ON public.direct_messages (sender_id, recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dm_recipient_unread
  ON public.direct_messages (recipient_id, read_at);

ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dm_read        ON public.direct_messages;
DROP POLICY IF EXISTS dm_update_read ON public.direct_messages;

CREATE POLICY dm_read
  ON public.direct_messages FOR SELECT
  USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

CREATE POLICY dm_update_read
  ON public.direct_messages FOR UPDATE
  USING (auth.uid() = recipient_id)
  WITH CHECK (auth.uid() = recipient_id);

GRANT SELECT, UPDATE ON public.direct_messages TO authenticated;

-- 3. RPC: отправить/обновить запрос в друзья.
-- Если есть встречный pending → сразу делаем accepted (symmetrical handshake).
CREATE OR REPLACE FUNCTION public.send_friend_request(p_to uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  me uuid := auth.uid();
  v_existing public.friendships%ROWTYPE;
  v_reverse  public.friendships%ROWTYPE;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF me = p_to THEN
    RAISE EXCEPTION 'cannot befriend yourself';
  END IF;

  -- Проверяем встречный запрос
  SELECT * INTO v_reverse FROM public.friendships
  WHERE requester_id = p_to AND addressee_id = me;

  IF v_reverse.id IS NOT NULL AND v_reverse.status = 'pending' THEN
    UPDATE public.friendships
    SET status = 'accepted', decided_at = now()
    WHERE id = v_reverse.id;
    RETURN jsonb_build_object('status', 'accepted', 'id', v_reverse.id);
  END IF;

  -- Проверяем мой запрос
  SELECT * INTO v_existing FROM public.friendships
  WHERE requester_id = me AND addressee_id = p_to;

  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('status', v_existing.status, 'id', v_existing.id);
  END IF;

  INSERT INTO public.friendships (requester_id, addressee_id, status)
  VALUES (me, p_to, 'pending')
  RETURNING id INTO v_existing.id;

  RETURN jsonb_build_object('status', 'pending', 'id', v_existing.id);
END $$;

GRANT EXECUTE ON FUNCTION public.send_friend_request TO authenticated;

-- 4. RPC: принять или отклонить запрос
CREATE OR REPLACE FUNCTION public.respond_to_friend_request(
  p_request_id bigint,
  p_accept     boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  UPDATE public.friendships
  SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
      decided_at = now()
  WHERE id = p_request_id
    AND addressee_id = me
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'request not found or not yours';
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.respond_to_friend_request TO authenticated;

-- 5. RPC: удалить из друзей
CREATE OR REPLACE FUNCTION public.unfriend(p_other uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  DELETE FROM public.friendships
  WHERE (requester_id = me AND addressee_id = p_other)
     OR (requester_id = p_other AND addressee_id = me);
END $$;

GRANT EXECUTE ON FUNCTION public.unfriend TO authenticated;

-- 6. RPC: статус дружбы с другим юзером (для UI)
-- Возвращает: 'none' | 'pending_outgoing' | 'pending_incoming' | 'friends' | 'declined' | 'blocked'
CREATE OR REPLACE FUNCTION public.get_friendship_status(p_other uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  me uuid := auth.uid();
  r public.friendships%ROWTYPE;
BEGIN
  IF me IS NULL OR me = p_other THEN RETURN 'none'; END IF;

  SELECT * INTO r FROM public.friendships
  WHERE (requester_id = me AND addressee_id = p_other)
     OR (requester_id = p_other AND addressee_id = me)
  LIMIT 1;

  IF r.id IS NULL THEN RETURN 'none'; END IF;

  IF r.status = 'accepted' THEN RETURN 'friends'; END IF;
  IF r.status = 'pending' AND r.requester_id = me THEN RETURN 'pending_outgoing'; END IF;
  IF r.status = 'pending' AND r.addressee_id = me THEN RETURN 'pending_incoming'; END IF;

  RETURN r.status;
END $$;

GRANT EXECUTE ON FUNCTION public.get_friendship_status TO authenticated;

-- 7. RPC: отправить сообщение. Разрешено только друзьям.
CREATE OR REPLACE FUNCTION public.send_direct_message(
  p_to           uuid,
  p_text         text,
  p_novel_id     bigint DEFAULT NULL,
  p_chapter_num  integer DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  me uuid := auth.uid();
  v_friends bool;
  v_id bigint;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF me = p_to THEN RAISE EXCEPTION 'cannot message yourself'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.friendships
    WHERE status = 'accepted'
      AND ((requester_id = me AND addressee_id = p_to)
        OR (requester_id = p_to AND addressee_id = me))
  ) INTO v_friends;

  IF NOT v_friends THEN
    RAISE EXCEPTION 'must be friends to send a message';
  END IF;

  INSERT INTO public.direct_messages
    (sender_id, recipient_id, text, attached_novel_id, attached_chapter_number)
  VALUES
    (me, p_to, btrim(p_text), p_novel_id, p_chapter_num)
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.send_direct_message TO authenticated;

-- 8. RPC: пометить все сообщения от p_other как прочитанные
CREATE OR REPLACE FUNCTION public.mark_dm_read(p_other uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  me uuid := auth.uid();
  v_count integer;
BEGIN
  IF me IS NULL THEN RETURN 0; END IF;

  UPDATE public.direct_messages
  SET read_at = now()
  WHERE recipient_id = me
    AND sender_id = p_other
    AND read_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.mark_dm_read TO authenticated;

-- 9. RPC: получить список собеседников (conversations) с последним сообщением и счётчиком unread
CREATE OR REPLACE FUNCTION public.list_conversations()
RETURNS TABLE (
  other_id      uuid,
  last_text     text,
  last_at       timestamptz,
  last_from_me  boolean,
  unread_count  integer
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  pairs AS (
    SELECT
      CASE WHEN sender_id = (SELECT uid FROM me) THEN recipient_id ELSE sender_id END AS other_id,
      id, text, created_at, sender_id, recipient_id, read_at
    FROM public.direct_messages
    WHERE sender_id = (SELECT uid FROM me) OR recipient_id = (SELECT uid FROM me)
  ),
  latest AS (
    SELECT DISTINCT ON (other_id) other_id, id, text, created_at, sender_id
    FROM pairs
    ORDER BY other_id, created_at DESC
  ),
  unread AS (
    SELECT sender_id AS other_id, COUNT(*)::int AS c
    FROM public.direct_messages
    WHERE recipient_id = (SELECT uid FROM me) AND read_at IS NULL
    GROUP BY sender_id
  )
  SELECT
    l.other_id,
    l.text,
    l.created_at,
    (l.sender_id = (SELECT uid FROM me)) AS last_from_me,
    COALESCE(u.c, 0) AS unread_count
  FROM latest l
  LEFT JOIN unread u ON u.other_id = l.other_id
  ORDER BY l.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.list_conversations TO authenticated;

-- 10. RPC: суммарное число непрочитанных сообщений
CREATE OR REPLACE FUNCTION public.unread_dm_count()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COUNT(*)::int FROM public.direct_messages
  WHERE recipient_id = auth.uid() AND read_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION public.unread_dm_count TO authenticated;
