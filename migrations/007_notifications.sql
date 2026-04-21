-- ============================================================
-- Миграция 007: центр уведомлений — триггеры и RPC
-- Расширяет существующую public.notifications (актор, группировка),
-- навешивает триггеры на события: сообщение, friend request, reply, подписка.
-- Зависит от 001, 006.
-- Безопасно для tene.fun: триггеры не трогают саму бизнес-логику.
-- ============================================================

-- 1. Расширяем notifications новыми колонками (актор + группировка)
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS actor_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS group_key     text,
  ADD COLUMN IF NOT EXISTS ref_novel_id  bigint REFERENCES public.novels(id) ON DELETE CASCADE;

-- Индексы для быстрых запросов
CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON public.notifications (user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_group
  ON public.notifications (user_id, group_key, created_at DESC)
  WHERE group_key IS NOT NULL;

-- RLS (если не включён)
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notif_self_read   ON public.notifications;
DROP POLICY IF EXISTS notif_self_update ON public.notifications;

CREATE POLICY notif_self_read
  ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY notif_self_update
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, UPDATE ON public.notifications TO authenticated;

-- 2. Триггер: новое сообщение → уведомление для recipient
CREATE OR REPLACE FUNCTION public.trg_notify_new_message()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_actor_name text;
BEGIN
  SELECT COALESCE(translator_display_name, user_name, 'Читатель')
  INTO v_actor_name
  FROM public.profiles WHERE id = NEW.sender_id;

  INSERT INTO public.notifications
    (user_id, type, text, target_url, actor_id, group_key)
  VALUES
    (NEW.recipient_id,
     'message',
     v_actor_name || ' написал_а сообщение',
     '/messages/' || NEW.sender_id,
     NEW.sender_id,
     'message:' || NEW.sender_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_dm_insert_notify ON public.direct_messages;
CREATE TRIGGER on_dm_insert_notify
  AFTER INSERT ON public.direct_messages
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_new_message();

-- 3. Триггер: friend request (pending) → уведомление для addressee
CREATE OR REPLACE FUNCTION public.trg_notify_friend_request()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_actor_name text;
BEGIN
  IF NEW.status <> 'pending' THEN RETURN NEW; END IF;

  SELECT COALESCE(translator_display_name, user_name, 'Читатель')
  INTO v_actor_name
  FROM public.profiles WHERE id = NEW.requester_id;

  INSERT INTO public.notifications
    (user_id, type, text, target_url, actor_id, group_key)
  VALUES
    (NEW.addressee_id,
     'friend_request',
     v_actor_name || ' добавил_а тебя в друзья',
     '/friends',
     NEW.requester_id,
     'friend_request:' || NEW.requester_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_friendship_insert_notify ON public.friendships;
CREATE TRIGGER on_friendship_insert_notify
  AFTER INSERT ON public.friendships
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_friend_request();

-- 4. Триггер: запрос принят (pending → accepted) → уведомление для requester
CREATE OR REPLACE FUNCTION public.trg_notify_friend_accepted()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_actor_name text;
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    SELECT COALESCE(translator_display_name, user_name, 'Читатель')
    INTO v_actor_name
    FROM public.profiles WHERE id = NEW.addressee_id;

    INSERT INTO public.notifications
      (user_id, type, text, target_url, actor_id, group_key)
    VALUES
      (NEW.requester_id,
       'friend_accepted',
       v_actor_name || ' принял_а заявку в друзья',
       '/u/' || NEW.addressee_id,
       NEW.addressee_id,
       'friend_accepted:' || NEW.addressee_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_friendship_update_notify ON public.friendships;
CREATE TRIGGER on_friendship_update_notify
  AFTER UPDATE ON public.friendships
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_friend_accepted();

-- 5. Триггер: ответ на комментарий → уведомление для автора родительского
CREATE OR REPLACE FUNCTION public.trg_notify_comment_reply()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_parent_user  uuid;
  v_novel_fb_id  text;
  v_actor_name   text;
BEGIN
  IF NEW.reply_to IS NULL THEN RETURN NEW; END IF;

  SELECT user_id INTO v_parent_user
  FROM public.comments WHERE id = NEW.reply_to;

  -- Не шлём уведомление самому себе
  IF v_parent_user IS NULL OR v_parent_user = NEW.user_id THEN RETURN NEW; END IF;

  SELECT firebase_id INTO v_novel_fb_id
  FROM public.novels WHERE id = NEW.novel_id;

  SELECT COALESCE(translator_display_name, user_name, 'Читатель')
  INTO v_actor_name
  FROM public.profiles WHERE id = NEW.user_id;

  INSERT INTO public.notifications
    (user_id, type, text, target_url, actor_id, group_key, ref_novel_id)
  VALUES
    (v_parent_user,
     'comment_reply',
     v_actor_name || ' ответил_а на твой комментарий',
     '/novel/' || COALESCE(v_novel_fb_id, '') || '/' || NEW.chapter_number || '#c' || NEW.id,
     NEW.user_id,
     'comment_reply:' || NEW.reply_to,
     NEW.novel_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_comment_reply_notify ON public.comments;
CREATE TRIGGER on_comment_reply_notify
  AFTER INSERT ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_comment_reply();

-- 6. Триггер: новая подписка → уведомление для translator
CREATE OR REPLACE FUNCTION public.trg_notify_new_subscription()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_actor_name text;
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;

  SELECT COALESCE(user_name, 'Читатель')
  INTO v_actor_name
  FROM public.profiles WHERE id = NEW.user_id;

  INSERT INTO public.notifications
    (user_id, type, text, target_url, actor_id, group_key)
  VALUES
    (NEW.translator_id,
     'new_subscriber',
     'У тебя новый подписчик: ' || v_actor_name || ' · ' || NEW.provider,
     '/admin/analytics',
     NEW.user_id,
     'new_subscriber:' || to_char(now(), 'YYYY-MM-DD'));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_subscription_insert_notify ON public.subscriptions;
CREATE TRIGGER on_subscription_insert_notify
  AFTER INSERT ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_new_subscription();

-- 7. RPC: список уведомлений (с автором)
CREATE OR REPLACE FUNCTION public.list_notifications(
  p_limit int DEFAULT 50,
  p_only_unread boolean DEFAULT false
) RETURNS TABLE (
  id              bigint,
  type            text,
  text            text,
  target_url      text,
  is_read         boolean,
  created_at      timestamptz,
  actor_id        uuid,
  actor_name      text,
  actor_avatar    text,
  group_key       text,
  ref_novel_id    bigint,
  group_count     int
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH my AS (
    SELECT n.*,
           COALESCE(p.translator_display_name, p.user_name) AS a_name,
           p.translator_avatar_url AS a_avatar
    FROM public.notifications n
    LEFT JOIN public.profiles p ON p.id = n.actor_id
    WHERE n.user_id = auth.uid()
      AND (NOT p_only_unread OR n.is_read = false)
  ),
  grouped AS (
    SELECT
      group_key,
      COUNT(*)::int AS cnt,
      MAX(created_at) AS last_at
    FROM my
    WHERE group_key IS NOT NULL
    GROUP BY group_key
  ),
  latest_per_group AS (
    SELECT DISTINCT ON (COALESCE(group_key, id::text))
      my.*
    FROM my
    LEFT JOIN grouped g ON g.group_key = my.group_key
    ORDER BY COALESCE(my.group_key, my.id::text), my.created_at DESC
  )
  SELECT
    l.id,
    l.type,
    l.text,
    l.target_url,
    l.is_read,
    l.created_at,
    l.actor_id,
    l.a_name     AS actor_name,
    l.a_avatar   AS actor_avatar,
    l.group_key,
    l.ref_novel_id,
    COALESCE(g.cnt, 1) AS group_count
  FROM latest_per_group l
  LEFT JOIN grouped g ON g.group_key = l.group_key
  ORDER BY l.created_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.list_notifications TO authenticated;

-- 8. RPC: число непрочитанных
CREATE OR REPLACE FUNCTION public.unread_notifications_count()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COUNT(*)::int FROM public.notifications
  WHERE user_id = auth.uid() AND is_read = false;
$$;

GRANT EXECUTE ON FUNCTION public.unread_notifications_count TO authenticated;

-- 9. RPC: пометить все как прочитанные
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_count int;
BEGIN
  UPDATE public.notifications
  SET is_read = true
  WHERE user_id = auth.uid() AND is_read = false;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read TO authenticated;
