-- ============================================================
-- 051: фикс — триггер автоодобрения Boosty-кэша должен работать
-- ТОЛЬКО для подписочных заявок.
--
-- Баг в миграции 049: trg_auto_approve_from_cache ищет pending-заявки
-- без фильтра по kind. Если читатель подаст МОНЕТНУЮ заявку
-- (kind='coins') с Boosty-email, триггер попытается создать ему
-- subscription вместо того, чтобы зачислить монеты. Платные главы
-- откроются, но монеты на кошелёк не придут — заявка зависнет в
-- approved-состоянии с пустым сроком и без coin_transaction.
--
-- То же самое — в submit_subscription_claim (переопределён в 049):
-- он ищет матч по external_username, но был написан в предположении,
-- что p_kind всегда subscription. На самом деле frontend дёргает
-- submit_subscription_claim именно для subscription, а для монет —
-- submit_coins_claim (мигр. 045), которая автоматику не трогает.
-- Всё равно подстрахуемся: в submit_subscription_claim явно не
-- создаём coins-заявки.
--
-- Безопасно для tene и существующих данных: только меняет поведение
-- триггера на более строгое.
-- ============================================================

CREATE OR REPLACE FUNCTION public.trg_auto_approve_from_cache()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_claim   public.subscription_claims%ROWTYPE;
  v_now     timestamptz := now();
  v_expires timestamptz;
BEGIN
  -- Только pending + subscription + boosty + с identifier'ом.
  -- Монетные (kind='coins') НЕ трогаем — для них действует ручной
  -- флоу в /admin/subscribers, потому что Boosty API в общем списке
  -- подписчиков не отдаёт суммы донатов/покупок, а её сверка —
  -- основной смысл ручного одобрения монет.
  FOR v_claim IN
    SELECT * FROM public.subscription_claims
    WHERE translator_id = NEW.translator_id
      AND status = 'pending'
      AND provider = 'boosty'
      AND COALESCE(kind, 'subscription') = 'subscription'
      AND external_username IS NOT NULL
      AND (
        (NEW.email_lc <> '' AND lower(btrim(external_username)) = NEW.email_lc) OR
        (NEW.name_lc  <> '' AND lower(btrim(external_username)) = NEW.name_lc)
      )
  LOOP
    v_expires := v_now + (v_claim.tier_months || ' months')::interval;

    INSERT INTO public.subscriptions
      (user_id, translator_id, provider, plan, status, started_at, expires_at)
    VALUES
      (v_claim.user_id, v_claim.translator_id, 'boosty', 'external_claim',
       'active', v_now, v_expires)
    ON CONFLICT (user_id, translator_id, plan, provider) DO UPDATE SET
      status     = 'active',
      expires_at = GREATEST(
        COALESCE(public.subscriptions.expires_at, v_now),
        v_now
      ) + (v_claim.tier_months || ' months')::interval;

    UPDATE public.subscription_claims
    SET status = 'approved', reviewed_at = v_now
    WHERE id = v_claim.id;
  END LOOP;

  RETURN NEW;
END $$;
