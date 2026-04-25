-- ============================================================
-- 054: chaptify_subscriptions — шаг 2/3
-- Переопределяем chaptify-RPC так, чтобы они писали/читали
-- chaptify_subscriptions, а НЕ subscriptions (tene).
--
-- Затрагиваем:
--   • submit_subscription_claim (мигр. 049)
--   • approve_subscription_claim (мигр. 045)
--   • grant_subscription_from_boosty_chat (мигр. 038)
--   • revoke_subscription (мигр. 041)
--   • can_read_chapter_chaptify (мигр. 036) — встроенно, БЕЗ вызова
--     общего can_read_chapter (он tene-шный и читает subscriptions)
--
-- public.subscriptions и public.can_read_chapter — НЕ трогаем.
-- Триггеры/RPC, специфичные для Boosty/Tribute webhook'ов — следующая
-- миграция (055).
-- ============================================================

-- ============================================================
-- can_read_chapter_chaptify — БЕЗ вызова общего can_read_chapter.
-- Логика та же: автор/команда/админ → пускаем; иначе ранний доступ
-- или подписка или штучная покупка — теперь читаем chaptify_subscriptions.
-- ============================================================
CREATE OR REPLACE FUNCTION public.can_read_chapter_chaptify(
  p_user    uuid,
  p_novel   bigint,
  p_chapter int
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_is_paid      boolean;
  v_translator   uuid;
  v_early_until  timestamptz;
  v_is_team      boolean := false;
  v_is_admin     boolean := false;
BEGIN
  SELECT c.is_paid, n.translator_id, c.early_access_until
  INTO v_is_paid, v_translator, v_early_until
  FROM public.chapters c
  JOIN public.novels   n ON n.id = c.novel_id
  WHERE c.novel_id = p_novel AND c.chapter_number = p_chapter
  LIMIT 1;

  IF p_user IS NOT NULL THEN
    IF p_user = v_translator THEN
      v_is_team := true;
    ELSE
      BEGIN
        SELECT EXISTS (
          SELECT 1 FROM public.novel_translators
          WHERE novel_id = p_novel AND user_id = p_user
        ) INTO v_is_team;
      EXCEPTION WHEN undefined_table THEN
        v_is_team := false;
      END;
    END IF;

    SELECT (is_admin = true OR role = 'admin')
    INTO v_is_admin
    FROM public.profiles WHERE id = p_user;
  END IF;

  IF v_is_team OR v_is_admin THEN RETURN true; END IF;

  -- Ранний доступ: пока период не истёк, главу видят только подписчики или купившие
  IF v_early_until IS NOT NULL AND v_early_until > now() THEN
    IF EXISTS (
      SELECT 1 FROM public.chaptify_subscriptions
      WHERE user_id = p_user AND translator_id = v_translator
        AND status = 'active' AND (expires_at IS NULL OR expires_at > now())
    ) THEN RETURN true; END IF;

    IF EXISTS (
      SELECT 1 FROM public.chapter_purchases
      WHERE user_id = p_user AND novel_id = p_novel AND chapter_number = p_chapter
    ) THEN RETURN true; END IF;

    RETURN false;
  END IF;

  -- Обычная логика для платных глав
  IF NOT v_is_paid THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.chaptify_subscriptions
    WHERE user_id       = p_user
      AND translator_id = v_translator
      AND status        = 'active'
      AND (expires_at IS NULL OR expires_at > now())
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.chapter_purchases
    WHERE user_id        = p_user
      AND novel_id       = p_novel
      AND chapter_number = p_chapter
  ) THEN RETURN true; END IF;

  RETURN false;
END $$;

-- GRANT уже есть с миграции 036, но повторим на всякий
GRANT EXECUTE ON FUNCTION public.can_read_chapter_chaptify(uuid, bigint, int) TO authenticated, anon;

-- ============================================================
-- submit_subscription_claim — версия из 049, но при auto-approve
-- через Boosty-кэш INSERT'ит в chaptify_subscriptions.
-- ============================================================
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
  v_user     uuid := auth.uid();
  v_code     text;
  v_existing bigint;
  v_clean_ext text;
  v_clean_note text;
  v_row      public.subscription_claims%ROWTYPE;
  v_match_id bigint;
  v_now      timestamptz := now();
  v_expires  timestamptz;
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

  IF COALESCE(p_provider, 'boosty') = 'boosty' AND v_clean_ext IS NOT NULL THEN
    SELECT boosty_user_id INTO v_match_id
    FROM public.boosty_subscriber_cache
    WHERE translator_id = p_translator_id
      AND (
        (email_lc <> '' AND email_lc = lower(v_clean_ext)) OR
        (name_lc  <> '' AND name_lc  = lower(v_clean_ext))
      )
      AND (subscribed_until IS NULL OR subscribed_until > now())
    ORDER BY subscribed_until DESC NULLS LAST
    LIMIT 1;
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

    -- НОВОЕ: chaptify_subscriptions вместо subscriptions
    INSERT INTO public.chaptify_subscriptions
      (user_id, translator_id, provider, plan, status, started_at, expires_at)
    VALUES
      (v_user, p_translator_id, 'boosty', 'external_claim', 'active', v_now, v_expires)
    ON CONFLICT (user_id, translator_id, plan, provider) DO UPDATE SET
      status     = 'active',
      expires_at = GREATEST(
        COALESCE(public.chaptify_subscriptions.expires_at, v_now),
        v_now
      ) + (p_tier_months || ' months')::interval;

    RETURN jsonb_build_object(
      'ok', true, 'claim', row_to_json(v_row), 'auto_approved', true
    );
  END IF;

  -- Стандартный pending-путь
  INSERT INTO public.subscription_claims
    (user_id, translator_id, provider, code, external_username, note, tier_months)
  VALUES
    (v_user, p_translator_id, COALESCE(p_provider, 'boosty'), v_code,
     v_clean_ext, v_clean_note, p_tier_months)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'claim', row_to_json(v_row));
END $$;

-- ============================================================
-- approve_subscription_claim — версия из 045, но subscription-ветка
-- INSERT'ит в chaptify_subscriptions.
-- ============================================================
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

    -- НОВОЕ: chaptify_subscriptions вместо subscriptions
    INSERT INTO public.chaptify_subscriptions
      (user_id, translator_id, provider, plan, status, started_at, expires_at)
    VALUES
      (v_claim.user_id, v_claim.translator_id, v_claim.provider,
       'external_claim', 'active', v_now, v_expires)
    ON CONFLICT (user_id, translator_id, plan, provider) DO UPDATE SET
      status     = 'active',
      expires_at = GREATEST(
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

-- ============================================================
-- grant_subscription_from_boosty_chat — версия из 038, но
-- INSERT'ит в chaptify_subscriptions.
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

  INSERT INTO public.chaptify_subscriptions
    (user_id, translator_id, provider, plan, status, started_at, expires_at)
  VALUES
    (p_user, p_translator, 'boosty', 'external_claim', 'active', v_now, v_expires)
  ON CONFLICT (user_id, translator_id, plan, provider) DO UPDATE SET
    status     = 'active',
    expires_at = GREATEST(
      COALESCE(public.chaptify_subscriptions.expires_at, v_now),
      v_now
    ) + (p_tier_months || ' months')::interval;

  RETURN jsonb_build_object('ok', true, 'expires_at', v_expires);
END $$;

-- ============================================================
-- revoke_subscription — версия из 041, но UPDATE'ит chaptify_subscriptions.
-- ============================================================
CREATE OR REPLACE FUNCTION public.revoke_subscription(
  p_subscription_id bigint,
  p_reason          text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me           uuid := auth.uid();
  v_sub          public.chaptify_subscriptions%ROWTYPE;
  v_is_admin     boolean := false;
  v_now          timestamptz := now();
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
  SET status = 'cancelled', expires_at = v_now
  WHERE id = p_subscription_id;

  -- Уведомляем читателя (как в оригинале)
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
