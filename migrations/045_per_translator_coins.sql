-- ============================================================
-- 045: per-translator coin wallets + чаевые = бесплатное «♥»
--
-- Юр-модель: chaptify НЕ проводит деньги между пользователями.
-- Каждый переводчик продаёт свои монеты читателю напрямую (Boosty /
-- Tribute / VK Donut / карта самозанятого). Chaptify только ведёт
-- учёт «сколько монет читатель X пред-оплатил у переводчика Y».
--
-- Что меняется:
--   1. Новая таблица reader_translator_coins — баланс на пару
--      (читатель, переводчик). Тратить можно только на главы этого
--      переводчика.
--   2. subscription_claims расширяется полем kind ('subscription' |
--      'coins') + coins_amount — теперь через этот же flow можно
--      заявить покупку монет.
--   3. buy_chapter переписан — списывает из per-translator баланса.
--   4. thank_chapter становится чисто социальным «♥» — монеты НЕ
--      списываются, никакие чаевые не идут.
--   5. approve_subscription_claim ветвится по kind: подписка или
--      зачисление монет.
--
-- Tene-safety:
--   - Старый profiles.coin_balance НЕ трогаем (tene пишет в него).
--   - Старая сигнатура buy_chapter(bigint,int) сохранена.
--   - RPC thank_chapter(bigint,int,int) оставляет 3-й параметр для
--     совместимости, но тихо игнорирует его.
-- ============================================================

-- ---- reader_translator_coins: кошельки на пару ----
CREATE TABLE IF NOT EXISTS public.reader_translator_coins (
  user_id       uuid  NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  translator_id uuid  NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  balance       int   NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, translator_id)
);

CREATE INDEX IF NOT EXISTS idx_rtc_translator
  ON public.reader_translator_coins (translator_id);

ALTER TABLE public.reader_translator_coins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rtc_reader_read     ON public.reader_translator_coins;
DROP POLICY IF EXISTS rtc_translator_read ON public.reader_translator_coins;
DROP POLICY IF EXISTS rtc_admin_all       ON public.reader_translator_coins;

-- Читатель видит свой баланс со всеми переводчиками
CREATE POLICY rtc_reader_read
  ON public.reader_translator_coins FOR SELECT
  USING (auth.uid() = user_id);

-- Переводчик видит свои начисления (для дашборда «кто мой читатель»)
CREATE POLICY rtc_translator_read
  ON public.reader_translator_coins FOR SELECT
  USING (auth.uid() = translator_id);

CREATE POLICY rtc_admin_all
  ON public.reader_translator_coins FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = true OR role = 'admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = true OR role = 'admin')
  ));

-- Пишут только security-definer RPC: покупка / одобренный claim / revoke.
REVOKE INSERT, UPDATE, DELETE ON public.reader_translator_coins FROM authenticated;
GRANT  SELECT                 ON public.reader_translator_coins TO authenticated;

-- ---- Расширение subscription_claims под монеты ----
ALTER TABLE public.subscription_claims
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'subscription';

ALTER TABLE public.subscription_claims
  ADD COLUMN IF NOT EXISTS coins_amount int;

-- CHECK обновляем аккуратно — старые ряды остаются 'subscription'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subscription_claims_kind_check'
  ) THEN
    ALTER TABLE public.subscription_claims
      ADD CONSTRAINT subscription_claims_kind_check
      CHECK (
        kind IN ('subscription', 'coins')
        AND (
          kind = 'subscription'
          OR (kind = 'coins' AND coins_amount IS NOT NULL AND coins_amount > 0 AND coins_amount <= 100000)
        )
      );
  END IF;
END $$;

-- Обновляем view, чтобы добавить новые колонки
DROP VIEW IF EXISTS public.subscription_claims_view;
CREATE VIEW public.subscription_claims_view AS
SELECT
  c.id,
  c.user_id,
  c.translator_id,
  c.provider,
  c.code,
  c.external_username,
  c.note,
  c.status,
  c.decline_reason,
  c.tier_months,
  c.kind,
  c.coins_amount,
  c.created_at,
  c.reviewed_at,
  u.user_name                       AS user_name,
  u.avatar_url                      AS user_avatar,
  t.user_name                       AS translator_name,
  t.translator_display_name         AS translator_display_name,
  t.avatar_url                      AS translator_avatar,
  t.translator_slug                 AS translator_slug,
  t.payout_boosty_url               AS translator_boosty_url
FROM public.subscription_claims c
LEFT JOIN public.profiles u ON u.id = c.user_id
LEFT JOIN public.profiles t ON t.id = c.translator_id;

ALTER VIEW public.subscription_claims_view OWNER TO supabase_admin;
GRANT SELECT ON public.subscription_claims_view TO authenticated;

-- ---- submit_subscription_claim: старая подпись, новая функциональность ----
-- Старые клиенты (без p_kind) продолжают слать «подписочные» заявки.
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

-- ---- submit_coins_claim: новая RPC под покупку монет ----
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
  IF v_user = p_translator_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cannot_claim_self');
  END IF;
  IF p_coins_amount IS NULL OR p_coins_amount < 1 OR p_coins_amount > 100000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  -- Существующий pending-claim на этого переводчика со статусом coins?
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
     1,  -- tier_months — для coins бессмысленно, но колонка NOT NULL в старой схеме
     'coins',
     p_coins_amount)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'claim', row_to_json(v_row));
END $$;

GRANT EXECUTE ON FUNCTION public.submit_coins_claim(uuid, text, int, text, text)
  TO authenticated;

-- ---- approve_subscription_claim: ветвится по kind ----
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
    -- Зачисляем монеты в per-translator кошелёк
    INSERT INTO public.reader_translator_coins (user_id, translator_id, balance, updated_at)
    VALUES (v_claim.user_id, v_claim.translator_id, v_claim.coins_amount, v_now)
    ON CONFLICT (user_id, translator_id) DO UPDATE SET
      balance    = reader_translator_coins.balance + v_claim.coins_amount,
      updated_at = v_now;

    UPDATE public.subscription_claims
    SET status = 'approved', reviewed_at = v_now
    WHERE id = p_claim_id;

    RETURN jsonb_build_object(
      'ok',            true,
      'kind',          'coins',
      'coins_amount',  v_claim.coins_amount
    );
  ELSE
    -- Классическая подписка: создаём / продлеваем subscriptions
    v_expires := v_now + (v_claim.tier_months || ' months')::interval;

    INSERT INTO public.subscriptions
      (user_id, translator_id, provider, plan, status, started_at, expires_at)
    VALUES
      (v_claim.user_id, v_claim.translator_id, v_claim.provider,
       'external_claim', 'active', v_now, v_expires)
    ON CONFLICT (user_id, translator_id, plan, provider) DO UPDATE SET
      status     = 'active',
      expires_at = GREATEST(
        COALESCE(public.subscriptions.expires_at, v_now),
        v_now
      ) + (v_claim.tier_months || ' months')::interval;

    UPDATE public.subscription_claims
    SET status = 'approved', reviewed_at = v_now
    WHERE id = p_claim_id;

    RETURN jsonb_build_object(
      'ok',         true,
      'kind',       'subscription',
      'expires_at', v_expires
    );
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.approve_subscription_claim(bigint) TO authenticated;

-- ---- buy_chapter: списание из per-translator кошелька ----
CREATE OR REPLACE FUNCTION public.buy_chapter(
  p_novel   bigint,
  p_chapter int
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user       uuid := auth.uid();
  v_balance    int;
  v_price      int;
  v_is_paid    boolean;
  v_translator uuid;
  v_already    boolean;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT c.price_coins, c.is_paid, n.translator_id
  INTO   v_price, v_is_paid, v_translator
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
    -- Внешний переводчик — монеты не работают в принципе, только
    -- прямая ссылка на его Boosty/Tribute
    RETURN jsonb_build_object('ok', false, 'error', 'external_translator');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.chapter_purchases
    WHERE user_id = v_user AND novel_id = p_novel AND chapter_number = p_chapter
  ) INTO v_already;

  IF v_already THEN
    RETURN jsonb_build_object('ok', true, 'already_owned', true, 'price', v_price);
  END IF;

  -- Берём/лочим per-translator баланс
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

  -- Списываем у читателя
  UPDATE public.reader_translator_coins
  SET    balance    = balance - v_price,
         updated_at = now()
  WHERE  user_id = v_user AND translator_id = v_translator;

  -- Переводчику НИЧЕГО не зачисляем — свои деньги он получил вне chaptify.
  -- Логируем только списание у читателя (audit).
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

-- ---- thank_chapter: чисто социальное «♥», монеты не списываются ----
-- Мигр. 031 расширила сигнатуру до (novel, chapter, tip_coins, message).
-- Переопределяем обе — 3-параметровую и 4-параметровую, чтобы старые
-- клиенты не тратили монеты втихую через 4-арную версию.

CREATE OR REPLACE FUNCTION public.thank_chapter(
  p_novel     bigint,
  p_chapter   int,
  p_tip_coins int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_translator  uuid;
  v_already     boolean;
BEGIN
  -- 3-й параметр сохранён для обратной совместимости клиентов.
  -- Игнорируем — новая модель запрещает денежные чаевые внутри платформы.
  PERFORM p_tip_coins;

  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT translator_id INTO v_translator
  FROM public.novels WHERE id = p_novel;

  SELECT EXISTS (
    SELECT 1 FROM public.chapter_thanks
    WHERE user_id = v_user AND novel_id = p_novel AND chapter_number = p_chapter
  ) INTO v_already;

  IF v_already THEN
    RETURN jsonb_build_object('ok', true, 'already_thanked', true);
  END IF;

  INSERT INTO public.chapter_thanks
    (user_id, novel_id, chapter_number, translator_id, tip_coins)
  VALUES
    (v_user, p_novel, p_chapter, v_translator, 0)
  ON CONFLICT (user_id, novel_id, chapter_number) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'tip_sent', 0);
END $$;

GRANT EXECUTE ON FUNCTION public.thank_chapter(bigint, int, int) TO authenticated;

-- 4-арная версия (tip_coins, message) — игнорируем деньги и текст.
-- Сохраняем исключительно чтобы старые клиенты не падали с
-- «function does not exist».
CREATE OR REPLACE FUNCTION public.thank_chapter(
  p_novel     bigint,
  p_chapter   int,
  p_tip_coins int  DEFAULT 0,
  p_message   text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_translator  uuid;
  v_already     boolean;
BEGIN
  PERFORM p_tip_coins;
  PERFORM p_message;

  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT translator_id INTO v_translator
  FROM public.novels WHERE id = p_novel;

  SELECT EXISTS (
    SELECT 1 FROM public.chapter_thanks
    WHERE user_id = v_user AND novel_id = p_novel AND chapter_number = p_chapter
  ) INTO v_already;

  IF v_already THEN
    RETURN jsonb_build_object('ok', true, 'already_thanked', true);
  END IF;

  INSERT INTO public.chapter_thanks
    (user_id, novel_id, chapter_number, translator_id, tip_coins)
  VALUES
    (v_user, p_novel, p_chapter, v_translator, 0)
  ON CONFLICT (user_id, novel_id, chapter_number) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'tip_sent', 0);
END $$;

GRANT EXECUTE ON FUNCTION public.thank_chapter(bigint, int, int, text) TO authenticated;

-- untoggle_thank уже есть в мигр. 028 — ничего не меняем, работает.

-- ---- RPC: мои балансы по переводчикам (для /profile и /t/[slug]) ----
CREATE OR REPLACE FUNCTION public.my_translator_wallets()
RETURNS TABLE (
  translator_id           uuid,
  user_name               text,
  translator_slug         text,
  translator_display_name text,
  translator_avatar_url   text,
  avatar_url              text,
  balance                 int,
  updated_at              timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT
    rtc.translator_id,
    p.user_name,
    p.translator_slug,
    p.translator_display_name,
    p.translator_avatar_url,
    p.avatar_url,
    rtc.balance,
    rtc.updated_at
  FROM public.reader_translator_coins rtc
  JOIN public.profiles p ON p.id = rtc.translator_id
  WHERE rtc.user_id = auth.uid()
  ORDER BY rtc.balance DESC, rtc.updated_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.my_translator_wallets() TO authenticated;

-- ---- RPC: баланс читателя у конкретного переводчика (paywall / /t/[slug]) ----
CREATE OR REPLACE FUNCTION public.my_balance_with(p_translator uuid)
RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE((
    SELECT balance FROM public.reader_translator_coins
    WHERE user_id = auth.uid() AND translator_id = p_translator
  ), 0);
$$;

GRANT EXECUTE ON FUNCTION public.my_balance_with(uuid) TO authenticated;

-- ---- Триггер уведомлений: chapter_tip больше не шлётся ----
-- Старый триггер on_chapter_tip уже не срабатывает (tip_coins всегда 0),
-- но дропнем явно, чтобы код стал читаемее.
DROP TRIGGER IF EXISTS on_chapter_tip ON public.chapter_thanks;
DROP FUNCTION IF EXISTS public.trg_notify_chapter_tip();
