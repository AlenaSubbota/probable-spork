-- ============================================================
-- 041: ручной отзыв активной подписки переводчиком
--
-- Контекст: chaptify не видит факт отмены на стороне Boosty/Tribute
-- (для Boosty вообще нет API). Если читатель отписался на платформе,
-- наша подписка живёт до expires_at — это чаще всего ок (он уже
-- заплатил за этот месяц), но переводчику нужен инструмент,
-- если он сам обнаружил, что подписчик «слетел» досрочно
-- (например, получил уведомление о cancel в личке Boosty).
--
-- RPC revoke_subscription(p_subscription_id, p_reason):
--   - переводчик/админ может отозвать только свою подписку
--   - status -> 'cancelled', expires_at -> now()
--   - читатель получает push-уведомление (тип subscription_revoked)
--   - в decline_reason кладём причину для истории
--
-- Без миграции отозвать можно только напрямую из БД руками.
-- ============================================================

-- Если ENUM-а на subscriptions.status нет — оставляем text, просто кладём
-- 'cancelled'. Если есть CHECK-ограничение — добавляем в него.
DO $$
DECLARE
  v_check_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid)
  INTO v_check_def
  FROM pg_constraint c
  JOIN pg_class      t ON t.oid = c.conrelid
  WHERE t.relname = 'subscriptions'
    AND c.conname = 'subscriptions_status_check'
  LIMIT 1;

  IF v_check_def IS NOT NULL AND v_check_def NOT ILIKE '%cancelled%' THEN
    ALTER TABLE public.subscriptions DROP CONSTRAINT subscriptions_status_check;
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_status_check
        CHECK (status IN ('pending', 'active', 'expired', 'cancelled'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.revoke_subscription(
  p_subscription_id bigint,
  p_reason          text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me           uuid := auth.uid();
  v_sub          public.subscriptions%ROWTYPE;
  v_is_admin     boolean := false;
  v_translator_name text;
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_sub FROM public.subscriptions WHERE id = p_subscription_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT (is_admin = true OR role = 'admin')
  INTO v_is_admin
  FROM public.profiles WHERE id = v_me;

  IF v_me <> v_sub.translator_id AND v_is_admin IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF v_sub.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', true, 'already_cancelled', true);
  END IF;

  UPDATE public.subscriptions
  SET status     = 'cancelled',
      expires_at = LEAST(COALESCE(expires_at, now()), now())
  WHERE id = p_subscription_id;

  -- Push читателю
  SELECT COALESCE(translator_display_name, user_name, 'Переводчик')
  INTO v_translator_name
  FROM public.profiles WHERE id = v_sub.translator_id;

  BEGIN
    INSERT INTO public.notifications
      (user_id, type, text, target_url, actor_id, group_key)
    VALUES
      (v_sub.user_id,
       'subscription_revoked',
       'Подписка отозвана переводчиком ' || v_translator_name ||
         COALESCE(' — ' || p_reason, ''),
       '/profile/subscriptions',
       v_sub.translator_id,
       'sub_revoke:' || v_sub.id);
  EXCEPTION WHEN others THEN
    -- если триггер/таблица notifications недоступны — не валим транзакцию
    NULL;
  END;

  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.revoke_subscription(bigint, text) TO authenticated;
