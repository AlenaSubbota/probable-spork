-- ============================================================
-- 080: Закрывает 2 CRITICAL пункта из RLS-аудита.
--
-- C1 (free subscription через Boosty display name)
--   Миграция 078 убрала name_lc из триггера trg_auto_approve_from_cache,
--   но оставила точно такую же ветку в RPC public.submit_subscription_claim
--   (мигр. 054, строки 161-172). Любой может ввести в external_username
--   ПУБЛИЧНОЕ display-имя другого Boosty-подписчика и получить чужую
--   подписку «бесплатно».
--
--   Фикс: удаляем name_lc-ветку из RPC. Только email-матчинг. Плюс
--   добавляем тот же translator_boosty_credentials guard, что в 078
--   (без подключённых credentials auto-approve вообще не работает —
--   защита от ввода фиктивных claim'ов).
--
-- C4 (revoke_subscription бесполезен, читатель тут же re-claim'ит)
--   Сейчас translator делает revoke → status='cancelled', expires_at=now().
--   Но boosty_subscriber_cache не чистится (он живёт по boosty_user_id,
--   а не по chaptify user), поэтому при следующем submit_subscription_claim
--   с тем же email auto-approve срабатывает ИЗ КЭША и подписка восстаёт.
--
--   Фикс: добавляем колонку chaptify_subscriptions.revoked_until. На
--   revoke выставляем её в far-future. Auto-approve пути (RPC и trigger)
--   проверяют: если для пары (user, translator, plan='external_claim')
--   есть строка с revoked_until > now() — auto-approve пропускается,
--   claim уходит в pending для ручного решения переводчика. Manual
--   approve через approve_subscription_claim очищает revoked_until.
--
-- Применять можно безопасно: ALTER TABLE ADD COLUMN IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION — никаких разрушительных операций.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Колонка revoked_until.
-- ------------------------------------------------------------
ALTER TABLE public.chaptify_subscriptions
  ADD COLUMN IF NOT EXISTS revoked_until timestamptz;

COMMENT ON COLUMN public.chaptify_subscriptions.revoked_until IS
  'Если установлено и > now(), auto-approve пути (RPC и trigger) '
  'игнорируют эту пару (user, translator) и не возрождают подписку '
  'из Boosty-кэша. Очищается на manual approve.';

CREATE INDEX IF NOT EXISTS idx_chaptify_sub_revoked
  ON public.chaptify_subscriptions (user_id, translator_id, plan)
  WHERE revoked_until IS NOT NULL;

-- ------------------------------------------------------------
-- 2. revoke_subscription: теперь ставит revoked_until.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_subscription(
  p_subscription_id bigint,
  p_reason          text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me              uuid := auth.uid();
  v_sub             public.chaptify_subscriptions%ROWTYPE;
  v_is_admin        boolean := false;
  v_now             timestamptz := now();
  v_translator_name text;
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_sub FROM public.chaptify_subscriptions WHERE id = p_subscription_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_sub.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_cancelled');
  END IF;

  SELECT (is_admin = true OR role = 'admin')
  INTO v_is_admin
  FROM public.profiles WHERE id = v_me;

  IF v_me <> v_sub.translator_id AND v_is_admin IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  UPDATE public.chaptify_subscriptions
  SET status        = 'cancelled',
      expires_at    = v_now,
      revoked_until = '2099-01-01'::timestamptz
  WHERE id = p_subscription_id;

  -- Уведомление читателю (без изменений по сравнению с мигр. 054).
  SELECT COALESCE(translator_display_name, user_name, 'Переводчик')
  INTO v_translator_name
  FROM public.profiles WHERE id = v_sub.translator_id;

  INSERT INTO public.notifications
    (user_id, type, text, target_url, actor_id, group_key)
  VALUES
    (v_sub.user_id, 'subscription_declined',
     'Подписка отозвана: ' || v_translator_name ||
       COALESCE(' — ' || p_reason, ''),
     '/profile/subscriptions',
     v_sub.translator_id,
     'sub_revoke:' || p_subscription_id);

  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.revoke_subscription(bigint, text)
  TO authenticated;

-- ------------------------------------------------------------
-- 3. submit_subscription_claim: убираем name_lc, добавляем
--    credentials guard и revoked_until guard.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_subscription_claim(
  p_translator_id uuid,
  p_provider      text DEFAULT 'boosty',
  p_external      text DEFAULT NULL,
  p_note          text DEFAULT NULL,
  p_tier_months   int  DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user           uuid := auth.uid();
  v_code           text;
  v_existing       bigint;
  v_clean_ext      text;
  v_clean_note     text;
  v_row            public.subscription_claims%ROWTYPE;
  v_match_id       bigint;
  v_now            timestamptz := now();
  v_expires        timestamptz;
  v_has_creds      boolean;
  v_revoked_until  timestamptz;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF v_user = p_translator_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cannot_claim_self');
  END IF;
  IF p_tier_months IS NULL OR p_tier_months < 1 OR p_tier_months > 12 THEN
    p_tier_months := 1;
  END IF;

  v_clean_ext  := NULLIF(btrim(COALESCE(p_external, '')), '');
  v_clean_note := NULLIF(btrim(COALESCE(p_note, '')), '');

  SELECT id INTO v_existing
  FROM public.subscription_claims
  WHERE user_id = v_user
    AND translator_id = p_translator_id
    AND status = 'pending'
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    SELECT * INTO v_row FROM public.subscription_claims WHERE id = v_existing;
    RETURN jsonb_build_object(
      'ok', true, 'claim', row_to_json(v_row), 'already_pending', true
    );
  END IF;

  v_code := 'C-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  -- Auto-approve gating:
  --   1) provider=boosty + есть external username
  --   2) у переводчика реально подключены Boosty-credentials (т.е. кэш
  --      может быть наполнен только нашим воркером, а не подменён через
  --      service-key утечку)
  --   3) пара (user, translator) НЕ ревокнута
  --   4) email-матчинг в кэше (НЕ name_lc — публичное display-имя
  --      ловится атакующим тривиально)
  IF COALESCE(p_provider, 'boosty') = 'boosty' AND v_clean_ext IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.translator_boosty_credentials
      WHERE translator_id = p_translator_id
    ) INTO v_has_creds;

    IF v_has_creds THEN
      SELECT revoked_until INTO v_revoked_until
      FROM public.chaptify_subscriptions
      WHERE user_id = v_user
        AND translator_id = p_translator_id
        AND plan = 'external_claim'
      ORDER BY id DESC
      LIMIT 1;

      IF v_revoked_until IS NULL OR v_revoked_until <= v_now THEN
        SELECT boosty_user_id INTO v_match_id
        FROM public.boosty_subscriber_cache
        WHERE translator_id = p_translator_id
          AND email_lc <> ''
          AND email_lc = lower(v_clean_ext)
          AND (subscribed_until IS NULL OR subscribed_until > now())
        ORDER BY subscribed_until DESC NULLS LAST
        LIMIT 1;
      END IF;
    END IF;
  END IF;

  IF v_match_id IS NOT NULL THEN
    -- ✓ Авто-одобрение
    v_expires := v_now + (p_tier_months || ' months')::interval;

    INSERT INTO public.subscription_claims
      (user_id, translator_id, provider, code, external_username, note,
       tier_months, status, reviewed_at)
    VALUES
      (v_user, p_translator_id, 'boosty', v_code, v_clean_ext, v_clean_note,
       p_tier_months, 'approved', v_now)
    RETURNING * INTO v_row;

    INSERT INTO public.chaptify_subscriptions
      (user_id, translator_id, provider, plan, status, started_at,
       expires_at, revoked_until)
    VALUES
      (v_user, p_translator_id, 'boosty', 'external_claim', 'active', v_now,
       v_expires, NULL)
    ON CONFLICT (user_id, translator_id, plan, provider) DO UPDATE SET
      status        = 'active',
      revoked_until = NULL,
      expires_at    = GREATEST(
        COALESCE(public.chaptify_subscriptions.expires_at, v_now),
        v_now
      ) + (p_tier_months || ' months')::interval;

    RETURN jsonb_build_object(
      'ok', true, 'claim', row_to_json(v_row), 'auto_approved', true
    );
  END IF;

  -- Стандартный pending-путь.
  INSERT INTO public.subscription_claims
    (user_id, translator_id, provider, code, external_username, note, tier_months)
  VALUES
    (v_user, p_translator_id, COALESCE(p_provider, 'boosty'), v_code,
     v_clean_ext, v_clean_note, p_tier_months)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'claim', row_to_json(v_row));
END $$;

GRANT EXECUTE ON FUNCTION public.submit_subscription_claim(uuid, text, text, text, int)
  TO authenticated;

-- ------------------------------------------------------------
-- 4. trg_auto_approve_from_cache: добавляем revoked_until guard.
--    (name_lc уже убран в 078; credentials guard тоже там.)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_auto_approve_from_cache()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_claim          public.subscription_claims%ROWTYPE;
  v_now            timestamptz := now();
  v_expires        timestamptz;
  v_has_creds      boolean;
  v_revoked_until  timestamptz;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.translator_boosty_credentials
    WHERE translator_id = NEW.translator_id
  ) INTO v_has_creds;
  IF NOT v_has_creds THEN
    RETURN NEW;
  END IF;

  FOR v_claim IN
    SELECT * FROM public.subscription_claims
    WHERE translator_id = NEW.translator_id
      AND status = 'pending'
      AND provider = 'boosty'
      AND COALESCE(kind, 'subscription') = 'subscription'
      AND external_username IS NOT NULL
      AND NEW.email_lc <> ''
      AND lower(btrim(external_username)) = NEW.email_lc
  LOOP
    -- Skip если переводчик ранее revoke'нул эту пару.
    SELECT revoked_until INTO v_revoked_until
    FROM public.chaptify_subscriptions
    WHERE user_id = v_claim.user_id
      AND translator_id = v_claim.translator_id
      AND plan = 'external_claim'
    ORDER BY id DESC
    LIMIT 1;

    IF v_revoked_until IS NOT NULL AND v_revoked_until > v_now THEN
      CONTINUE;
    END IF;

    v_expires := v_now + (v_claim.tier_months || ' months')::interval;

    INSERT INTO public.chaptify_subscriptions
      (user_id, translator_id, provider, plan, status, started_at,
       expires_at, revoked_until)
    VALUES
      (v_claim.user_id, v_claim.translator_id, 'boosty', 'external_claim',
       'active', v_now, v_expires, NULL)
    ON CONFLICT (user_id, translator_id, plan, provider) DO UPDATE SET
      status        = 'active',
      revoked_until = NULL,
      expires_at    = GREATEST(
        COALESCE(public.chaptify_subscriptions.expires_at, v_now),
        v_now
      ) + (v_claim.tier_months || ' months')::interval;

    UPDATE public.subscription_claims
    SET status = 'approved', reviewed_at = v_now
    WHERE id = v_claim.id;
  END LOOP;

  RETURN NEW;
END $$;

-- ------------------------------------------------------------
-- 5. approve_subscription_claim: при ручном approve очищаем
--    revoked_until — это «передумал, разрешил снова».
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_subscription_claim(p_claim_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me        uuid := auth.uid();
  v_claim     public.subscription_claims%ROWTYPE;
  v_is_admin  boolean := false;
  v_now       timestamptz := now();
  v_expires   timestamptz;
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_claim FROM public.subscription_claims WHERE id = p_claim_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_claim.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_reviewed');
  END IF;

  SELECT (is_admin = true OR role = 'admin')
  INTO v_is_admin
  FROM public.profiles WHERE id = v_me;

  IF v_me <> v_claim.translator_id AND v_is_admin IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF v_claim.kind = 'coins' THEN
    INSERT INTO public.reader_translator_coins (user_id, translator_id, balance, updated_at)
    VALUES (v_claim.user_id, v_claim.translator_id, v_claim.coins_amount, v_now)
    ON CONFLICT (user_id, translator_id) DO UPDATE SET
      balance    = reader_translator_coins.balance + v_claim.coins_amount,
      updated_at = v_now;

    UPDATE public.subscription_claims
    SET status = 'approved', reviewed_at = v_now
    WHERE id = p_claim_id;

    RETURN jsonb_build_object(
      'ok', true, 'kind', 'coins', 'coins_amount', v_claim.coins_amount
    );
  ELSE
    v_expires := v_now + (v_claim.tier_months || ' months')::interval;

    INSERT INTO public.chaptify_subscriptions
      (user_id, translator_id, provider, plan, status, started_at,
       expires_at, revoked_until)
    VALUES
      (v_claim.user_id, v_claim.translator_id, v_claim.provider,
       'external_claim', 'active', v_now, v_expires, NULL)
    ON CONFLICT (user_id, translator_id, plan, provider) DO UPDATE SET
      status        = 'active',
      revoked_until = NULL,
      expires_at    = GREATEST(
        COALESCE(public.chaptify_subscriptions.expires_at, v_now),
        v_now
      ) + (v_claim.tier_months || ' months')::interval;

    UPDATE public.subscription_claims
    SET status = 'approved', reviewed_at = v_now
    WHERE id = p_claim_id;

    RETURN jsonb_build_object(
      'ok', true, 'kind', 'subscription', 'expires_at', v_expires
    );
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.approve_subscription_claim(bigint)
  TO authenticated;

-- ------------------------------------------------------------
-- 6. grant_subscription_from_boosty_chat: тоже учитывает revoke.
--    Эта RPC дёргается из бота после ответа в чат — если переводчик
--    сделал revoke, бот не должен возрождать подписку.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_subscription_from_boosty_chat(
  p_user         uuid,
  p_translator   uuid,
  p_tier_months  int DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now           timestamptz := now();
  v_expires       timestamptz;
  v_revoked_until timestamptz;
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

  SELECT revoked_until INTO v_revoked_until
  FROM public.chaptify_subscriptions
  WHERE user_id = p_user
    AND translator_id = p_translator
    AND plan = 'external_claim'
  ORDER BY id DESC
  LIMIT 1;

  IF v_revoked_until IS NOT NULL AND v_revoked_until > v_now THEN
    RETURN jsonb_build_object('ok', false, 'error', 'revoked_by_translator');
  END IF;

  v_expires := v_now + (p_tier_months || ' months')::interval;

  INSERT INTO public.chaptify_subscriptions
    (user_id, translator_id, provider, plan, status, started_at,
     expires_at, revoked_until)
  VALUES
    (p_user, p_translator, 'boosty', 'external_claim', 'active', v_now,
     v_expires, NULL)
  ON CONFLICT (user_id, translator_id, plan, provider) DO UPDATE SET
    status        = 'active',
    revoked_until = NULL,
    expires_at    = GREATEST(
      COALESCE(public.chaptify_subscriptions.expires_at, v_now),
      v_now
    ) + (p_tier_months || ' months')::interval;

  RETURN jsonb_build_object('ok', true, 'expires_at', v_expires);
END $$;
