-- ============================================================
-- 052: автосинк Tribute через webhook
--
-- Цель: когда читатель оформляет подписку или делает донат у переводчика
-- на Tribute, Tribute шлёт нам webhook (new_subscription / renewed /
-- cancelled / new_donation / recurrent_donation / cancelled_donation).
-- Мы сами активируем подписку (по telegram_user_id → profiles.telegram_id)
-- или зачисляем монеты (матчим M-XXXXXXXX из поля `message` донатa
-- против pending coin-claim'а и сверяем сумму).
--
-- Три новые сущности:
--   1) translator_tribute_credentials — зашифрованный API-Key переводчика
--      (им же Tribute подписывает webhooks HMAC-SHA256). Шифруется тем же
--      ключом BOOSTY_CREDS_KEY (переиспользуем, чтобы не плодить env-vars).
--   2) pending_tribute_subscriptions — если webhook new_subscription пришёл
--      для telegram_user_id, которого у нас ещё нет в profiles, сохраняем
--      тут, чтобы активировать, как только юзер залогинится через TG.
--   3) tribute_events_processed — дедупликация webhook'ов (Tribute ретраит
--      при ошибках, нельзя дважды продлить подписку/зачислить монеты).
--
-- Все RPC — SECURITY DEFINER, доступны либо владельцу (для настройки),
-- либо service_role (для webhook-handler'а).
-- ============================================================

-- ============================================================
-- 1) translator_tribute_credentials
-- ============================================================
CREATE TABLE IF NOT EXISTS public.translator_tribute_credentials (
  translator_id   uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  api_key_enc     bytea NOT NULL,   -- AES-256-GCM (iv || ct || tag)
  webhook_secret  bytea,            -- на будущее, если Tribute добавит отдельный secret
  last_event_at   timestamptz,
  last_event_name text,
  last_error      text,
  events_count    int   NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.translator_tribute_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.translator_tribute_credentials FROM anon, authenticated;

-- ============================================================
-- 2) tribute_events_processed — дедупликация
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tribute_events_processed (
  translator_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Для подписки event_key = 'sub:<subscription_id>:<period_id>' (уникально
  -- для каждого продления). Для доната — 'don:<donation_request_id>:<sent_at>'
  -- или 'order:<order_id>'. Формируется на стороне webhook-handler'а.
  event_key       text NOT NULL,
  event_name      text NOT NULL,
  payload_digest  text,             -- sha256 от тела, для отладки
  processed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (translator_id, event_key)
);

CREATE INDEX IF NOT EXISTS idx_tribute_events_recent
  ON public.tribute_events_processed (translator_id, processed_at DESC);

ALTER TABLE public.tribute_events_processed ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tribute_events_processed FROM anon, authenticated;

-- ============================================================
-- 3) pending_tribute_subscriptions — отложенная активация
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pending_tribute_subscriptions (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  translator_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  telegram_user_id   bigint NOT NULL,
  telegram_username  text,
  email              text,
  subscription_id    bigint,      -- Tribute-ный subscription id
  period_id          bigint,
  subscription_name  text,
  type               text,        -- 'regular' | 'gift' | 'trial'
  price              numeric(12,2),
  amount             numeric(12,2),
  currency           text,
  expires_at         timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  activated_at       timestamptz  -- NULL = ещё не привязан к user
);

CREATE INDEX IF NOT EXISTS idx_pending_tribute_tg
  ON public.pending_tribute_subscriptions (telegram_user_id)
  WHERE activated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pending_tribute_translator
  ON public.pending_tribute_subscriptions (translator_id, created_at DESC);

ALTER TABLE public.pending_tribute_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pending_tribute_subscriptions FROM anon, authenticated;

-- Переводчик видит свои pending-записи (чтобы в админке было
-- понятно, что «есть оплативший через Tribute, но ещё не пришёл на сайт»).
CREATE POLICY pending_tribute_owner_read
  ON public.pending_tribute_subscriptions FOR SELECT
  USING (auth.uid() = translator_id);

GRANT SELECT ON public.pending_tribute_subscriptions TO authenticated;

-- ============================================================
-- RPC: статус подключения Tribute (для UI переводчика)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_my_tribute_connection_status()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me    uuid := auth.uid();
  v_row   public.translator_tribute_credentials%ROWTYPE;
  v_token text;
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT payout_tribute_webhook_token INTO v_token
  FROM public.profiles WHERE id = v_me;

  SELECT * INTO v_row
  FROM public.translator_tribute_credentials
  WHERE translator_id = v_me;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok',            true,
      'connected',     false,
      'webhook_token', v_token
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',              true,
    'connected',       true,
    'webhook_token',   v_token,
    'last_event_at',   v_row.last_event_at,
    'last_event_name', v_row.last_event_name,
    'last_error',      v_row.last_error,
    'events_count',    v_row.events_count,
    'created_at',      v_row.created_at
  );
END $$;

REVOKE ALL ON FUNCTION public.get_my_tribute_connection_status() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_tribute_connection_status() TO authenticated;

-- ============================================================
-- RPC: отвязка Tribute
-- ============================================================
CREATE OR REPLACE FUNCTION public.disconnect_my_tribute()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  DELETE FROM public.translator_tribute_credentials WHERE translator_id = v_me;
  -- pending_tribute_subscriptions НЕ чистим — там могут быть живые оплаты
  -- от ещё-не-зарегистрированных юзеров, удаление = потеря данных.

  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.disconnect_my_tribute() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.disconnect_my_tribute() TO authenticated;

-- ============================================================
-- RPC: найти переводчика по webhook-токену (для handler'а).
-- Возвращает translator_id + зашифрованный api_key, чтобы handler
-- сам его расшифровал и проверил HMAC.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_tribute_by_webhook_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_tr_id uuid;
  v_key   bytea;
BEGIN
  SELECT id INTO v_tr_id
  FROM public.profiles
  WHERE payout_tribute_webhook_token = p_token
  LIMIT 1;

  IF v_tr_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unknown_token');
  END IF;

  SELECT api_key_enc INTO v_key
  FROM public.translator_tribute_credentials
  WHERE translator_id = v_tr_id;

  IF v_key IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'tribute_not_connected',
      'translator_id', v_tr_id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',             true,
    'translator_id',  v_tr_id,
    'api_key_enc_hex', encode(v_key, 'hex')
  );
END $$;

REVOKE ALL ON FUNCTION public.get_tribute_by_webhook_token(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_tribute_by_webhook_token(text) TO service_role;

-- ============================================================
-- RPC: применить webhook-событие (универсальный диспетчер).
-- Вызывается из API-route после успешной проверки HMAC.
-- Возвращает {ok, action, ...details}.
-- Идемпотентность: по паре (translator_id, event_key) в tribute_events_processed.
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_tribute_event(
  p_translator_id uuid,
  p_event_name    text,
  p_event_key     text,
  p_payload       jsonb,
  p_api_key_enc_hex text DEFAULT NULL  -- на случай если надо обновить
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_already     boolean;
  v_tg_user     bigint;
  v_user_id     uuid;
  v_now         timestamptz := now();
  v_expires     timestamptz;
  v_amount      numeric;
  v_currency    text;
  v_message     text;
  v_code        text;
  v_claim       public.subscription_claims%ROWTYPE;
  v_sub_type    text;
BEGIN
  -- 1) Дедупликация
  SELECT EXISTS (
    SELECT 1 FROM public.tribute_events_processed
    WHERE translator_id = p_translator_id AND event_key = p_event_key
  ) INTO v_already;

  IF v_already THEN
    RETURN jsonb_build_object('ok', true, 'action', 'duplicate_ignored');
  END IF;

  -- 2) Обновляем телеметрию
  UPDATE public.translator_tribute_credentials
  SET last_event_at   = v_now,
      last_event_name = p_event_name,
      events_count    = events_count + 1,
      last_error      = NULL,
      updated_at      = v_now
  WHERE translator_id = p_translator_id;

  v_tg_user  := (p_payload->>'telegram_user_id')::bigint;
  v_amount   := (p_payload->>'amount')::numeric;
  v_currency := lower(COALESCE(p_payload->>'currency', ''));
  v_message  := COALESCE(p_payload->>'message', '');
  v_sub_type := COALESCE(p_payload->>'type', 'regular');

  -- ─────────────── ПОДПИСКИ ───────────────
  IF p_event_name IN ('new_subscription', 'renewed_subscription') THEN
    v_expires := (p_payload->>'expires_at')::timestamptz;

    -- Ищем user_id по telegram_id
    SELECT id INTO v_user_id
    FROM public.profiles WHERE telegram_id = v_tg_user LIMIT 1;

    IF v_user_id IS NULL THEN
      -- Юзер ещё не зарегистрирован на chaptify — кладём в очередь,
      -- активируем при логине через TG.
      INSERT INTO public.pending_tribute_subscriptions
        (translator_id, telegram_user_id, telegram_username, email,
         subscription_id, period_id, subscription_name, type,
         price, amount, currency, expires_at)
      VALUES
        (p_translator_id, v_tg_user,
         p_payload->>'telegram_username',
         p_payload->>'email',
         NULLIF(p_payload->>'subscription_id','')::bigint,
         NULLIF(p_payload->>'period_id','')::bigint,
         p_payload->>'subscription_name',
         v_sub_type,
         NULLIF(p_payload->>'price','')::numeric,
         v_amount,
         v_currency,
         v_expires);

      INSERT INTO public.tribute_events_processed
        (translator_id, event_key, event_name, payload_digest)
      VALUES
        (p_translator_id, p_event_key, p_event_name,
         md5(p_payload::text));

      RETURN jsonb_build_object('ok', true, 'action', 'pending_no_user');
    END IF;

    -- Активируем/продляем подписку. expires_at берём из Tribute as-is —
    -- они сами считают период, прибавлять не надо.
    INSERT INTO public.subscriptions
      (user_id, translator_id, provider, plan, status, started_at, expires_at)
    VALUES
      (v_user_id, p_translator_id, 'tribute', 'external_claim', 'active',
       v_now, v_expires)
    ON CONFLICT (user_id, translator_id, plan, provider) DO UPDATE SET
      status     = 'active',
      expires_at = GREATEST(
        COALESCE(public.subscriptions.expires_at, v_now),
        v_expires  -- берём более поздний из DB и payload'a
      );

    -- Уведомление читателю
    INSERT INTO public.notifications
      (user_id, type, text, target_url, actor_id, group_key)
    VALUES
      (v_user_id, 'subscription_approved',
       'Подписка Tribute активирована — доступ ко всем платным главам до ' ||
         to_char(v_expires, 'DD.MM.YYYY'),
       '/profile/subscriptions',
       p_translator_id,
       'tribute_sub:' || COALESCE(p_payload->>'subscription_id', p_event_key));

    INSERT INTO public.tribute_events_processed
      (translator_id, event_key, event_name, payload_digest)
    VALUES
      (p_translator_id, p_event_key, p_event_name, md5(p_payload::text));

    RETURN jsonb_build_object(
      'ok', true, 'action', 'subscription_granted',
      'user_id', v_user_id, 'expires_at', v_expires
    );
  END IF;

  -- ─────────────── ОТМЕНА ПОДПИСКИ ───────────────
  IF p_event_name = 'cancelled_subscription' THEN
    -- Не отзываем мгновенно: это «отменил автопродление», доступ живёт
    -- до expires_at (который уже в DB). Просто логируем.
    INSERT INTO public.tribute_events_processed
      (translator_id, event_key, event_name, payload_digest)
    VALUES
      (p_translator_id, p_event_key, p_event_name, md5(p_payload::text));

    RETURN jsonb_build_object('ok', true, 'action', 'cancel_logged');
  END IF;

  -- ─────────────── ДОНАТ (одноразовый или рекуррент) ───────────────
  IF p_event_name IN ('new_donation', 'recurrent_donation') THEN
    -- Разрешаем автоматику только в рублях — конвертировать валюты не умеем.
    IF v_currency <> 'rub' THEN
      INSERT INTO public.tribute_events_processed
        (translator_id, event_key, event_name, payload_digest)
      VALUES
        (p_translator_id, p_event_key, p_event_name, md5(p_payload::text));
      RETURN jsonb_build_object(
        'ok', true, 'action', 'donation_non_rub_skipped',
        'currency', v_currency
      );
    END IF;

    -- Ищем M-XXXXXXXX в message. Код может быть обрамлён любыми символами.
    v_code := (regexp_match(v_message, 'M-[A-F0-9]{8}', 'i'))[1];
    IF v_code IS NULL THEN
      INSERT INTO public.tribute_events_processed
        (translator_id, event_key, event_name, payload_digest)
      VALUES
        (p_translator_id, p_event_key, p_event_name, md5(p_payload::text));
      RETURN jsonb_build_object('ok', true, 'action', 'donation_no_code');
    END IF;
    v_code := upper(v_code);

    SELECT * INTO v_claim
    FROM public.subscription_claims
    WHERE code = v_code
      AND translator_id = p_translator_id
      AND kind = 'coins'
      AND status = 'pending'
    LIMIT 1;

    IF NOT FOUND THEN
      INSERT INTO public.tribute_events_processed
        (translator_id, event_key, event_name, payload_digest)
      VALUES
        (p_translator_id, p_event_key, p_event_name, md5(p_payload::text));
      RETURN jsonb_build_object(
        'ok', true, 'action', 'donation_code_not_found',
        'code', v_code
      );
    END IF;

    -- Сумма в копейках → рубли (делим на 100). Монеты 1:1 к рублям.
    -- Даём допуск ±1 монета чтобы не ругаться из-за копеек (комиссия).
    DECLARE
      v_paid_coins int := floor(v_amount / 100);
    BEGIN
      IF v_paid_coins < v_claim.coins_amount - 1 THEN
        -- Заплатили меньше — оставляем pending, переводчик решит вручную
        INSERT INTO public.tribute_events_processed
          (translator_id, event_key, event_name, payload_digest)
        VALUES
          (p_translator_id, p_event_key, p_event_name, md5(p_payload::text));
        RETURN jsonb_build_object(
          'ok', true, 'action', 'donation_amount_too_low',
          'claim_id', v_claim.id,
          'claimed', v_claim.coins_amount,
          'paid', v_paid_coins
        );
      END IF;

      -- Совпадение (или overpay) — зачисляем фактически уплаченную сумму,
      -- но не больше чем заявлено (на случай opportunistic overpay).
      INSERT INTO public.reader_translator_coins
        (user_id, translator_id, balance, updated_at)
      VALUES
        (v_claim.user_id, v_claim.translator_id,
         LEAST(v_paid_coins, v_claim.coins_amount), v_now)
      ON CONFLICT (user_id, translator_id) DO UPDATE SET
        balance    = reader_translator_coins.balance +
                     LEAST(v_paid_coins, v_claim.coins_amount),
        updated_at = v_now;

      UPDATE public.subscription_claims
      SET status = 'approved', reviewed_at = v_now
      WHERE id = v_claim.id;

      INSERT INTO public.notifications
        (user_id, type, text, target_url, actor_id, group_key)
      VALUES
        (v_claim.user_id, 'subscription_approved',
         LEAST(v_paid_coins, v_claim.coins_amount) ||
           ' монет зачислено (донат Tribute подтверждён автоматически).',
         '/profile/subscriptions', p_translator_id,
         'tribute_don:' || v_claim.id);

      INSERT INTO public.tribute_events_processed
        (translator_id, event_key, event_name, payload_digest)
      VALUES
        (p_translator_id, p_event_key, p_event_name, md5(p_payload::text));

      RETURN jsonb_build_object(
        'ok', true, 'action', 'donation_coins_granted',
        'claim_id', v_claim.id,
        'credited', LEAST(v_paid_coins, v_claim.coins_amount)
      );
    END;
  END IF;

  -- ─────────────── ОТМЕНА РЕКУРРЕНТ-ДОНАТА ───────────────
  IF p_event_name = 'cancelled_donation' THEN
    INSERT INTO public.tribute_events_processed
      (translator_id, event_key, event_name, payload_digest)
    VALUES
      (p_translator_id, p_event_key, p_event_name, md5(p_payload::text));
    RETURN jsonb_build_object('ok', true, 'action', 'cancel_logged');
  END IF;

  -- Неизвестное / не обрабатываемое событие (physical_order_*, digital_product_*)
  INSERT INTO public.tribute_events_processed
    (translator_id, event_key, event_name, payload_digest)
  VALUES
    (p_translator_id, p_event_key, p_event_name, md5(p_payload::text));

  RETURN jsonb_build_object(
    'ok', true, 'action', 'event_ignored', 'event_name', p_event_name
  );
END $$;

REVOKE ALL ON FUNCTION public.apply_tribute_event(uuid, text, text, jsonb, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.apply_tribute_event(uuid, text, text, jsonb, text) TO service_role;

-- ============================================================
-- RPC: сохранить API-Key (вызывается из auth-service, который сам шифрует).
-- Доступно только service_role — обычный переводчик попадает сюда через
-- /auth/tribute-connect.
-- ============================================================
CREATE OR REPLACE FUNCTION public.save_tribute_api_key(
  p_translator_id uuid,
  p_api_key_enc_hex text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_translator_id IS NULL OR p_api_key_enc_hex IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_args');
  END IF;

  INSERT INTO public.translator_tribute_credentials
    (translator_id, api_key_enc, updated_at)
  VALUES
    (p_translator_id, decode(p_api_key_enc_hex, 'hex'), now())
  ON CONFLICT (translator_id) DO UPDATE SET
    api_key_enc = EXCLUDED.api_key_enc,
    last_error  = NULL,
    updated_at  = now();

  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.save_tribute_api_key(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.save_tribute_api_key(uuid, text) TO service_role;

-- ============================================================
-- Хук: при логине TG-юзера активировать pending-подписки.
-- Запускаем из auth-service-chaptify после /auth/telegram (существующий
-- трейт «новый юзер») — он сам вызывает этот RPC через service_role.
-- ============================================================
CREATE OR REPLACE FUNCTION public.activate_pending_tribute_for_user(
  p_user_id uuid,
  p_telegram_user_id bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row   public.pending_tribute_subscriptions%ROWTYPE;
  v_now   timestamptz := now();
  v_count int := 0;
BEGIN
  FOR v_row IN
    SELECT * FROM public.pending_tribute_subscriptions
    WHERE telegram_user_id = p_telegram_user_id
      AND activated_at IS NULL
      AND expires_at > v_now
  LOOP
    INSERT INTO public.subscriptions
      (user_id, translator_id, provider, plan, status, started_at, expires_at)
    VALUES
      (p_user_id, v_row.translator_id, 'tribute', 'external_claim',
       'active', v_now, v_row.expires_at)
    ON CONFLICT (user_id, translator_id, plan, provider) DO UPDATE SET
      status     = 'active',
      expires_at = GREATEST(public.subscriptions.expires_at, v_row.expires_at);

    UPDATE public.pending_tribute_subscriptions
    SET activated_at = v_now WHERE id = v_row.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'activated', v_count);
END $$;

REVOKE ALL ON FUNCTION public.activate_pending_tribute_for_user(uuid, bigint) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.activate_pending_tribute_for_user(uuid, bigint) TO service_role;
