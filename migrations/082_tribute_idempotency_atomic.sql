-- ============================================================
-- 082: C3 — атомарная идемпотентность Tribute webhook'ов.
--
-- Проблема (мигр. 055:86-93):
--   apply_tribute_event сначала делает SELECT EXISTS на
--   tribute_events_processed, и только в КОНЦЕ каждой ветки
--   делает INSERT в эту таблицу. Tribute ретраит вебхуки по
--   таймауту → две параллельные транзакции для ОДНОГО event_key:
--
--     T1: SELECT EXISTS → false (ещё ничего не вставлено)
--     T2: SELECT EXISTS → false (то же самое; T1 ещё не закоммитила)
--     T1: процессит подписку → INSERT chaptify_subscriptions, INSERT
--         tribute_events_processed → COMMIT
--     T2: процессит ту же подписку (баланс монет начисляется ВТОРОЙ
--         раз, expires_at продлевается ВТОРОЙ раз) → INSERT
--         tribute_events_processed → CONFLICT на (translator_id,
--         event_key) PK → ROLLBACK ВСЕГО.
--
--   В лучшем случае T2 откатывается (но даёт false-error в логах).
--   В худшем — если PK constraint когда-нибудь снимут или обойдут —
--   будет double-credit.
--
-- Фикс: INSERT в tribute_events_processed делается ПЕРВЫМ
-- действием функции с ON CONFLICT DO NOTHING RETURNING 1. Если
-- запись успешно вставилась — мы «владеем» этим event_key и
-- спокойно процессим. Если конфликт — мгновенно возвращаем
-- duplicate_ignored. T2 не делает никакой бизнес-логики.
--
-- Также: при ошибке любой INSERT/UPDATE внутри функции вся
-- транзакция откатывается — включая insert в tribute_events_processed.
-- Это значит, что на ретрае Tribute отдаст тот же event_key и мы
-- его обработаем заново (важно для real-OK retry-flow).
-- ============================================================

CREATE OR REPLACE FUNCTION public.apply_tribute_event(
  p_translator_id   uuid,
  p_event_name      text,
  p_event_key       text,
  p_payload         jsonb,
  p_api_key_enc_hex text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_inserted    bigint;
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
  -- АТОМАРНАЯ ПРОВЕРКА И КЛЕЙМ ИДЕМПОТЕНТНОСТИ.
  -- Если этот (translator_id, event_key) уже был обработан, INSERT
  -- даст конфликт, RETURNING вернёт NULL → выходим.
  -- Если конфликта нет — мы успешно вставили запись и теперь
  -- эксклюзивно обрабатываем этот event. Параллельная транзакция
  -- увидит наш INSERT (после нашего COMMIT) или сама получит конфликт.
  INSERT INTO public.tribute_events_processed
    (translator_id, event_key, event_name, payload_digest)
  VALUES
    (p_translator_id, p_event_key, p_event_name, md5(p_payload::text))
  ON CONFLICT (translator_id, event_key) DO NOTHING
  RETURNING id INTO v_inserted;

  IF v_inserted IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'action', 'duplicate_ignored');
  END IF;

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

    SELECT id INTO v_user_id
    FROM public.profiles WHERE telegram_id = v_tg_user LIMIT 1;

    IF v_user_id IS NULL THEN
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
         v_amount, v_currency, v_expires);

      RETURN jsonb_build_object('ok', true, 'action', 'pending_no_user');
    END IF;

    INSERT INTO public.chaptify_subscriptions
      (user_id, translator_id, provider, plan, status, started_at, expires_at)
    VALUES
      (v_user_id, p_translator_id, 'tribute', 'external_claim', 'active',
       v_now, v_expires)
    ON CONFLICT (user_id, translator_id, plan, provider) DO UPDATE SET
      status     = 'active',
      expires_at = GREATEST(
        COALESCE(public.chaptify_subscriptions.expires_at, v_now),
        v_expires
      );

    INSERT INTO public.notifications
      (user_id, type, text, target_url, actor_id, group_key)
    VALUES
      (v_user_id, 'subscription_approved',
       'Подписка Tribute активирована — доступ ко всем платным главам до ' ||
         to_char(v_expires, 'DD.MM.YYYY'),
       '/profile/subscriptions',
       p_translator_id,
       'tribute_sub:' || COALESCE(p_payload->>'subscription_id', p_event_key));

    RETURN jsonb_build_object(
      'ok', true, 'action', 'subscription_granted',
      'user_id', v_user_id, 'expires_at', v_expires
    );
  END IF;

  -- ─────────────── ОТМЕНА ПОДПИСКИ ───────────────
  IF p_event_name = 'cancelled_subscription' THEN
    RETURN jsonb_build_object('ok', true, 'action', 'cancel_logged');
  END IF;

  -- ─────────────── ДОНАТ ───────────────
  IF p_event_name IN ('new_donation', 'recurrent_donation') THEN
    IF v_currency <> 'rub' THEN
      RETURN jsonb_build_object(
        'ok', true, 'action', 'donation_non_rub_skipped', 'currency', v_currency
      );
    END IF;

    v_code := (regexp_match(v_message, 'M-[A-F0-9]{8}', 'i'))[1];
    IF v_code IS NULL THEN
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
      RETURN jsonb_build_object(
        'ok', true, 'action', 'donation_code_not_found', 'code', v_code
      );
    END IF;

    DECLARE
      v_paid_coins int := floor(v_amount / 100);
    BEGIN
      IF v_paid_coins < v_claim.coins_amount - 1 THEN
        RETURN jsonb_build_object(
          'ok', true, 'action', 'donation_amount_too_low',
          'claim_id', v_claim.id,
          'claimed', v_claim.coins_amount, 'paid', v_paid_coins
        );
      END IF;

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

      RETURN jsonb_build_object(
        'ok', true, 'action', 'donation_coins_granted',
        'claim_id', v_claim.id,
        'credited', LEAST(v_paid_coins, v_claim.coins_amount)
      );
    END;
  END IF;

  IF p_event_name = 'cancelled_donation' THEN
    RETURN jsonb_build_object('ok', true, 'action', 'cancel_logged');
  END IF;

  RETURN jsonb_build_object('ok', true, 'action', 'event_ignored', 'event_name', p_event_name);
END $$;

GRANT EXECUTE ON FUNCTION public.apply_tribute_event(uuid, text, text, jsonb, text)
  TO service_role;
