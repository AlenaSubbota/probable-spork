-- ============================================================
-- 070: блокировка платёжных RPC для аккаунтов в очереди на удаление
--
-- После `request_my_account_deletion` (мигр. 068) клиент делается
-- signOut, но JWT может ещё быть валиден до своего expires_at — у
-- атакующего/злоумышленника есть «окно» использования токена. Плюс
-- в редких сценариях (кросс-табы, бот) аккаунт может вернуться к
-- активной сессии. Защита: на стороне платёжных RPC сверяем, нет
-- ли pending-запроса на удаление, и если есть — отказываем.
--
-- Покрываем три точки:
--   • buy_chapter — покупка главы за монеты;
--   • submit_coins_claim — заявка на пополнение монет;
--   • submit_subscription_claim — заявка на подписку.
--
-- Все три уже SECURITY DEFINER. Добавляем helper-функцию и вызываем
-- её в начале каждой.
-- ============================================================

-- helper: возвращает true, если у юзера висит pending-запрос на
-- удаление аккаунта. Используется и в SQL-RPC, и потенциально
-- в RLS-политиках в будущем.
CREATE OR REPLACE FUNCTION public.is_account_pending_deletion(p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.account_deletion_requests
    WHERE user_id = p_user AND status = 'pending'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_account_pending_deletion(uuid)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- buy_chapter — добавляем guard поверх версии из мигр. 069
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.buy_chapter(
  p_novel   bigint,
  p_chapter int
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_balance     int;
  v_price       int;
  v_is_paid     boolean;
  v_translator  uuid;
  v_already     boolean;
  v_accepts     boolean;
  v_has_content boolean;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  -- H2: блокируем покупки для удаляемых аккаунтов. Тихо игнорируем,
  -- если таблица ещё не создана (мигр. 068).
  BEGIN
    IF public.is_account_pending_deletion(v_user) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'account_pending_deletion');
    END IF;
  EXCEPTION WHEN undefined_table OR undefined_function THEN
    NULL;
  END;

  SELECT
    c.price_coins,
    c.is_paid,
    n.translator_id,
    c.content_path IS NOT NULL AND length(btrim(c.content_path)) > 0
  INTO v_price, v_is_paid, v_translator, v_has_content
  FROM public.chapters c
  JOIN public.novels   n ON n.id = c.novel_id
  WHERE c.novel_id = p_novel AND c.chapter_number = p_chapter
  LIMIT 1;

  IF v_price IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'chapter_not_found');
  END IF;
  IF NOT v_is_paid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'chapter_is_free');
  END IF;
  IF v_translator IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'external_translator');
  END IF;
  IF NOT v_has_content THEN
    RETURN jsonb_build_object('ok', false, 'error', 'chapter_no_content');
  END IF;

  SELECT COALESCE(accepts_coins_for_chapters, true)
  INTO v_accepts
  FROM public.profiles
  WHERE id = v_translator;
  IF NOT COALESCE(v_accepts, true) THEN
    RETURN jsonb_build_object(
      'ok',            false,
      'error',         'translator_coins_disabled',
      'translator_id', v_translator
    );
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.chapter_purchases
    WHERE user_id = v_user AND novel_id = p_novel AND chapter_number = p_chapter
  ) INTO v_already;

  IF v_already THEN
    RETURN jsonb_build_object('ok', true, 'already_owned', true, 'price', v_price);
  END IF;

  SELECT balance INTO v_balance
  FROM public.reader_translator_coins
  WHERE user_id = v_user AND translator_id = v_translator
  FOR UPDATE;

  IF v_balance IS NULL OR v_balance < v_price THEN
    RETURN jsonb_build_object(
      'ok',            false,
      'error',         'insufficient_balance',
      'price',         v_price,
      'balance',       COALESCE(v_balance, 0),
      'translator_id', v_translator
    );
  END IF;

  UPDATE public.reader_translator_coins
  SET    balance    = balance - v_price,
         updated_at = now()
  WHERE  user_id = v_user AND translator_id = v_translator;

  INSERT INTO public.coin_transactions
    (user_id, amount, reason, reference_type, reference_id)
  VALUES
    (v_user, -v_price, 'chapter_purchase', 'chapter',
     p_novel::text || ':' || p_chapter::text);

  INSERT INTO public.chapter_purchases
    (user_id, novel_id, chapter_number, translator_id, price_coins)
  VALUES
    (v_user, p_novel, p_chapter, v_translator, v_price)
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'ok',            true,
    'price',         v_price,
    'balance',       v_balance - v_price,
    'translator_id', v_translator
  );
END $$;

GRANT EXECUTE ON FUNCTION public.buy_chapter(bigint, int) TO authenticated;

-- ------------------------------------------------------------
-- submit_coins_claim — добавляем guard поверх версии из мигр. 045
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_coins_claim(
  p_translator_id uuid,
  p_provider      text DEFAULT 'boosty',
  p_coins_amount  int  DEFAULT 100,
  p_external      text DEFAULT NULL,
  p_note          text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_code  text;
  v_existing_id bigint;
  v_row   public.subscription_claims%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  BEGIN
    IF public.is_account_pending_deletion(v_user) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'account_pending_deletion');
    END IF;
  EXCEPTION WHEN undefined_table OR undefined_function THEN
    NULL;
  END;

  IF v_user = p_translator_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cannot_claim_self');
  END IF;
  IF p_coins_amount IS NULL OR p_coins_amount < 1 OR p_coins_amount > 100000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  SELECT id INTO v_existing_id
  FROM public.subscription_claims
  WHERE user_id = v_user
    AND translator_id = p_translator_id
    AND kind = 'coins'
    AND status = 'pending'
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    SELECT * INTO v_row
    FROM public.subscription_claims WHERE id = v_existing_id;
    RETURN jsonb_build_object(
      'ok',    true,
      'claim', row_to_json(v_row),
      'already_pending', true
    );
  END IF;

  v_code := 'M-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  INSERT INTO public.subscription_claims
    (user_id, translator_id, provider, code, external_username, note, tier_months, kind, coins_amount)
  VALUES
    (v_user, p_translator_id, COALESCE(p_provider, 'boosty'), v_code,
     NULLIF(btrim(COALESCE(p_external, '')), ''),
     NULLIF(btrim(COALESCE(p_note, '')), ''),
     1,
     'coins',
     p_coins_amount)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'claim', row_to_json(v_row));
END $$;

GRANT EXECUTE ON FUNCTION public.submit_coins_claim(uuid, text, int, text, text)
  TO authenticated;

-- ------------------------------------------------------------
-- submit_subscription_claim — добавляем guard поверх версии из 045
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
  v_user  uuid := auth.uid();
  v_code  text;
  v_existing_id bigint;
  v_row   public.subscription_claims%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  BEGIN
    IF public.is_account_pending_deletion(v_user) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'account_pending_deletion');
    END IF;
  EXCEPTION WHEN undefined_table OR undefined_function THEN
    NULL;
  END;

  IF v_user = p_translator_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cannot_claim_self');
  END IF;
  IF p_tier_months IS NULL OR p_tier_months < 1 OR p_tier_months > 12 THEN
    p_tier_months := 1;
  END IF;

  SELECT id INTO v_existing_id
  FROM public.subscription_claims
  WHERE user_id = v_user
    AND translator_id = p_translator_id
    AND kind = 'subscription'
    AND status = 'pending'
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    SELECT * INTO v_row
    FROM public.subscription_claims WHERE id = v_existing_id;
    RETURN jsonb_build_object(
      'ok',    true,
      'claim', row_to_json(v_row),
      'already_pending', true
    );
  END IF;

  v_code := 'C-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  INSERT INTO public.subscription_claims
    (user_id, translator_id, provider, code, external_username, note, tier_months, kind)
  VALUES
    (v_user, p_translator_id, COALESCE(p_provider, 'boosty'), v_code,
     NULLIF(btrim(COALESCE(p_external, '')), ''),
     NULLIF(btrim(COALESCE(p_note, '')), ''),
     p_tier_months,
     'subscription')
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'claim', row_to_json(v_row));
END $$;

GRANT EXECUTE ON FUNCTION public.submit_subscription_claim(uuid, text, text, text, int)
  TO authenticated;
