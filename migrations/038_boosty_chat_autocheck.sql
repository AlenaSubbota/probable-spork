-- ============================================================
-- 038: автосинк Boosty через закрытый Telegram-чат подписчиков
--
-- Boosty умеет автоматически добавлять подписчиков в связанный закрытый
-- TG-чат. Переводчик добавляет @chaptifybot в этот чат — и у нас есть
-- real-time способ проверить «оплатил ли этот читатель подписку»:
-- getChatMember(chat_id, user_tg_id) в Telegram API.
--
-- Новое поле: translator_payment_methods.tg_chat_id (BIGINT).
-- Применимо только к provider='boosty'.
-- Если задано — на paywall появляется кнопка «Я уже подписан(а) —
-- открыть автоматически» → бот проверяет членство → subscriptions active.
-- ============================================================

ALTER TABLE public.translator_payment_methods
  ADD COLUMN IF NOT EXISTS tg_chat_id bigint;

-- Индекс чтобы быстро находить метод по chat_id (для валидации
-- на стороне бота / auth-service).
CREATE INDEX IF NOT EXISTS idx_payment_methods_tg_chat
  ON public.translator_payment_methods (tg_chat_id)
  WHERE tg_chat_id IS NOT NULL;

-- Обновляем view чтобы tg_chat_id тоже был доступен на фронте.
-- CREATE OR REPLACE VIEW не даёт добавить колонку в середину —
-- поэтому DROP + CREATE.
DROP VIEW IF EXISTS public.translator_payment_methods_view;
CREATE VIEW public.translator_payment_methods_view AS
SELECT
  pm.id,
  pm.translator_id,
  pm.provider,
  pm.url,
  pm.instructions,
  pm.enabled,
  pm.sort_order,
  pm.tg_chat_id,
  pm.created_at,
  p.user_name        AS translator_name,
  p.translator_display_name AS translator_display_name,
  p.avatar_url       AS translator_avatar
FROM public.translator_payment_methods pm
LEFT JOIN public.profiles p ON p.id = pm.translator_id;

ALTER VIEW public.translator_payment_methods_view OWNER TO supabase_admin;
GRANT SELECT ON public.translator_payment_methods_view TO anon, authenticated;

-- ============================================================
-- RPC: активировать подписку по факту подтверждённого членства
-- в Boosty-TG-чате. Вызывается из auth-service-chaptify (серверная
-- часть делает getChatMember, потом зовёт этот RPC через service_role).
--
-- SECURITY DEFINER, но мы не даём его EXECUTE обычным authenticated —
-- только service_role.
-- ============================================================
CREATE OR REPLACE FUNCTION public.grant_subscription_from_boosty_chat(
  p_user         uuid,
  p_translator   uuid,
  p_tier_months  int DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now     timestamptz := now();
  v_expires timestamptz;
BEGIN
  IF p_user IS NULL OR p_translator IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_args');
  END IF;
  IF p_user = p_translator THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cannot_subscribe_self');
  END IF;
  IF p_tier_months IS NULL OR p_tier_months < 1 OR p_tier_months > 12 THEN
    p_tier_months := 1;
  END IF;

  v_expires := v_now + (p_tier_months || ' months')::interval;

  INSERT INTO public.subscriptions
    (user_id, translator_id, provider, plan, status, started_at, expires_at)
  VALUES
    (p_user, p_translator, 'boosty', 'external_claim', 'active', v_now, v_expires)
  ON CONFLICT (user_id, translator_id, plan, provider) DO UPDATE SET
    status     = 'active',
    expires_at = GREATEST(
      COALESCE(public.subscriptions.expires_at, v_now),
      v_now
    ) + (p_tier_months || ' months')::interval;

  RETURN jsonb_build_object(
    'ok',         true,
    'expires_at', v_expires
  );
END $$;

-- Только service_role — клиенты не должны вызывать напрямую
REVOKE ALL ON FUNCTION public.grant_subscription_from_boosty_chat(uuid, uuid, int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.grant_subscription_from_boosty_chat(uuid, uuid, int) TO service_role;
