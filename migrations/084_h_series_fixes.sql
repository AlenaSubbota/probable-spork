-- ============================================================
-- 084: H-серия фиксов из RLS-аудита.
--
-- H1  approve_subscription_claim race: добавляем FOR UPDATE на claim-row
--     внутри транзакции, чтобы две параллельные «approve» не дублировали
--     extend на expires_at. (chaptify_subscriptions защищена ON CONFLICT,
--     но subscription_claims обновлялась без лока — race-окно осталось.)
--
-- H2  consume_boosty_connect_token race: вместо SELECT-then-UPDATE
--     делаем атомарный UPDATE ... WHERE consumed_at IS NULL RETURNING.
--     Если RETURNING пустой — токен уже потрачен или отсутствует.
--
-- H3  marketplace_applications: state-machine trigger. Запрещает
--     переходы:
--       withdrawn → *      (withdrawn — терминал)
--       accepted  → pending  (нельзя «отозвать accept» через UPDATE)
--       declined  → accepted (нельзя реверсить, audit-комментарий выше)
--     Разрешено: pending → accepted/declined/withdrawn,
--                accepted → declined (admin recall),
--                любой no-op (status то же).
--
-- H4  add_coins: SET search_path = public, pg_catalog. Без него любая
--     утечка service-role токена + подмена search_path = malicious'
--     может перехватить запись.
--
-- H5  thank_chapter: гейт на can_read_chapter_chaptify. Нельзя ставить
--     «спасибо» главам, к которым у читателя нет доступа (платным
--     неоплаченным). Иначе инфлируются счётчики и leak-ится факт
--     взаимодействия с непрочитанной главой.
--
-- H6  chapter_purchases.price_coins: CHECK BETWEEN 1 AND 500.
--
-- H7  chapter_thanks.tip_coins: CHECK = 0. Колонка остаётся для
--     обратной совместимости в JSON, но запрещаем отличные от нуля
--     значения (старая модель чаевых выпилена в мигр. 045).
--
-- H9  translator_thanks: UPDATE политика разрешала переводчику менять
--     ЛЮБУЮ колонку, включая текст сообщения от читателя (forgery).
--     Сужаем до конкретных колонок через REVOKE+GRANT column-level.
-- ============================================================

-- ------------------------------------------------------------
-- H1 — approve_subscription_claim с FOR UPDATE
-- (полная функция переписана из 080; добавлен только FOR UPDATE)
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

  -- Лочим claim-строку: параллельные approve серилизуются здесь.
  -- Если уже approved/declined — после лока сразу выходим.
  SELECT * INTO v_claim
  FROM public.subscription_claims
  WHERE id = p_claim_id
  FOR UPDATE;

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
-- H2 — consume_boosty_connect_token атомарно
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_boosty_connect_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_translator_id uuid;
  v_status        text;
BEGIN
  IF p_token IS NULL OR length(p_token) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_token');
  END IF;

  -- Атомарный consume: UPDATE ... WHERE consumed_at IS NULL ставит
  -- лок на строку и в RETURNING отдаёт её только при успехе. Если
  -- уже consumed — вернёт 0 строк и мы выходим. Параллельные вызовы
  -- сериализуются через row-lock.
  UPDATE public.boosty_connect_tokens
  SET consumed_at = now()
  WHERE token = p_token
    AND consumed_at IS NULL
    AND expires_at >= now()
  RETURNING translator_id
  INTO v_translator_id;

  IF v_translator_id IS NULL THEN
    -- Различаем причины: not_found / already_consumed / expired —
    -- одним SELECT после UPDATE для гранулярного error-кода.
    SELECT
      CASE
        WHEN consumed_at IS NOT NULL THEN 'already_consumed'
        WHEN expires_at < now() THEN 'expired'
        ELSE 'not_found'
      END
    INTO v_status
    FROM public.boosty_connect_tokens
    WHERE token = p_token
    LIMIT 1;

    RETURN jsonb_build_object(
      'ok', false,
      'error', COALESCE(v_status, 'not_found')
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',            true,
    'translator_id', v_translator_id
  );
END $$;

REVOKE ALL ON FUNCTION public.consume_boosty_connect_token(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.consume_boosty_connect_token(text) TO service_role;

-- ------------------------------------------------------------
-- H3 — marketplace_applications state-machine trigger
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_marketplace_app_status_fsm()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- withdrawn — терминал.
  IF OLD.status = 'withdrawn' THEN
    RAISE EXCEPTION 'application already withdrawn — terminal state'
      USING ERRCODE = '22023';
  END IF;

  -- accepted ↔ pending: запрещено (нельзя «отозвать accept» через
  -- direct UPDATE; только через explicit decline или cancel).
  IF OLD.status = 'accepted' AND NEW.status = 'pending' THEN
    RAISE EXCEPTION 'cannot revert accepted application back to pending'
      USING ERRCODE = '22023';
  END IF;

  -- declined → accepted: запрещено (forgery counterparty для reviews).
  -- Если хочешь дать второй шанс — отдельный путь: новый INSERT.
  IF OLD.status = 'declined' AND NEW.status = 'accepted' THEN
    RAISE EXCEPTION
      'cannot promote declined application back to accepted (audit)'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS marketplace_app_status_fsm ON public.marketplace_applications;
CREATE TRIGGER marketplace_app_status_fsm
  BEFORE UPDATE OF status ON public.marketplace_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_marketplace_app_status_fsm();

-- ------------------------------------------------------------
-- H4 — add_coins SET search_path
-- ------------------------------------------------------------
ALTER FUNCTION public.add_coins(uuid, int, text, text, text)
  SET search_path = public, pg_catalog;

-- ------------------------------------------------------------
-- H5 — thank_chapter гейт через can_read_chapter_chaptify
-- (две арности — 3 и 4 параметра — обе обновляем одинаково)
-- ------------------------------------------------------------
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
  v_can_read    boolean;
BEGIN
  -- 3-й параметр сохранён для обратной совместимости клиентов.
  PERFORM p_tip_coins;

  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  -- Гейт: «спасибо» можно ставить только за главы, к которым есть
  -- доступ. Иначе платная-неоплаченная глава засчитывает сердечко
  -- и инфлирует translator-метрики, плюс leaks факт взаимодействия.
  v_can_read := public.can_read_chapter_chaptify(v_user, p_novel, p_chapter);
  IF NOT v_can_read THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_access');
  END IF;

  SELECT translator_id INTO v_translator
  FROM public.novels WHERE id = p_novel;

  INSERT INTO public.chapter_thanks
    (user_id, novel_id, chapter_number, translator_id, tip_coins)
  VALUES
    (v_user, p_novel, p_chapter, v_translator, 0)
  ON CONFLICT (user_id, novel_id, chapter_number) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'tip_sent', 0);
END $$;

GRANT EXECUTE ON FUNCTION public.thank_chapter(bigint, int, int) TO authenticated;

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
  v_can_read    boolean;
BEGIN
  PERFORM p_tip_coins;
  PERFORM p_message;

  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  v_can_read := public.can_read_chapter_chaptify(v_user, p_novel, p_chapter);
  IF NOT v_can_read THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_access');
  END IF;

  SELECT translator_id INTO v_translator
  FROM public.novels WHERE id = p_novel;

  INSERT INTO public.chapter_thanks
    (user_id, novel_id, chapter_number, translator_id, tip_coins)
  VALUES
    (v_user, p_novel, p_chapter, v_translator, 0)
  ON CONFLICT (user_id, novel_id, chapter_number) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'tip_sent', 0);
END $$;

GRANT EXECUTE ON FUNCTION public.thank_chapter(bigint, int, int, text) TO authenticated;

-- ------------------------------------------------------------
-- H6 — chapter_purchases.price_coins CHECK
-- ------------------------------------------------------------
ALTER TABLE public.chapter_purchases
  DROP CONSTRAINT IF EXISTS chapter_purchases_price_bounded;
ALTER TABLE public.chapter_purchases
  ADD CONSTRAINT chapter_purchases_price_bounded
  CHECK (price_coins BETWEEN 1 AND 500) NOT VALID;

-- ------------------------------------------------------------
-- H7 — chapter_thanks.tip_coins CHECK = 0
-- (модель чаевых выпилена в мигр. 045; колонку оставляем для legacy)
-- ------------------------------------------------------------
ALTER TABLE public.chapter_thanks
  DROP CONSTRAINT IF EXISTS chapter_thanks_tip_zero;
ALTER TABLE public.chapter_thanks
  ADD CONSTRAINT chapter_thanks_tip_zero
  CHECK (tip_coins = 0) NOT VALID;

-- ------------------------------------------------------------
-- H9 — translator_thanks: scoped UPDATE
-- Раньше переводчик мог UPDATE любую колонку, включая message/payload.
-- Сужаем до is_public, is_read, read_at — больше ничего ему менять
-- не нужно.
-- ------------------------------------------------------------
REVOKE UPDATE ON public.translator_thanks FROM authenticated;
GRANT  UPDATE (is_public, is_read, read_at)
  ON public.translator_thanks TO authenticated;
-- DELETE остаётся у автора через политику tt_delete_reader (мигр. 060).

-- ============================================================
-- Откат:
--   ALTER FUNCTION public.add_coins(uuid, int, text, text, text)
--     RESET search_path;
--   DROP TRIGGER IF EXISTS marketplace_app_status_fsm
--     ON public.marketplace_applications;
--   DROP FUNCTION IF EXISTS public.trg_marketplace_app_status_fsm();
--   ALTER TABLE public.chapter_purchases
--     DROP CONSTRAINT IF EXISTS chapter_purchases_price_bounded;
--   ALTER TABLE public.chapter_thanks
--     DROP CONSTRAINT IF EXISTS chapter_thanks_tip_zero;
--   GRANT UPDATE ON public.translator_thanks TO authenticated;
--   -- (восстановить старые версии thank_chapter/consume_boosty_connect_token/
--   --  approve_subscription_claim из мигр. 045/049/080 при необходимости)
-- ============================================================
