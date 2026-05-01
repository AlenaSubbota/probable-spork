-- ============================================================
-- 081: ещё два CRITICAL пункта из RLS-аудита.
--
-- C5 (coin_transactions: админ может UPDATE/DELETE историю)
--   Миграция 077 переписала политики и поставила coin_tx_admin_all
--   как FOR ALL. Это означает: любой админ (или скомпрометированная
--   роль) может изменить или удалить запись из ledger'а — аудит-трейл
--   перестаёт быть аудитом. Также у coin_transactions.amount нет
--   CHECK-ограничений: технически можно записать 0 или абсурдно
--   большие значения, и в сочетании с багами в SECURITY DEFINER функ-
--   ций это маскирует ошибки.
--
--   Фикс: заменяем admin FOR ALL на SELECT-only. Любые корректирующие
--   движения должны идти через add_coins / buy_chapter / approve_*
--   RPCs, которые добавляют новую compensating-запись, а не правят
--   существующие. Также добавляем CHECK на amount: != 0 и BETWEEN
--   −1M и +1M (защита от случайного переполнения).
--
-- C6 (marketplace_applications: applicant перетаскивает свой отклик
--   на чужой листинг)
--   После 077 политика apps_self_update запрещает менять status (для
--   self-accept), но не запрещает менять listing_id/applicant_id.
--   Атакующий: создаёт pending-application на свой листинг, потом
--   UPDATE listing_id = (чужой) — переносит свою запись на чужой
--   листинг (спам, замусоривание чужой очереди откликов, фейк-counter
--   party для marketplace_reviews).
--
--   Фикс: BEFORE UPDATE триггер запрещает менять listing_id и
--   applicant_id вообще. Если хочешь withdraw — есть status='withdrawn'
--   через apps_self_update. Если хочешь подать отдельный отклик на
--   другой листинг — это новая INSERT-строка.
--
-- Безопасно: только DROP POLICY → CREATE POLICY и ADD CONSTRAINT
-- NOT VALID + CREATE TRIGGER. Существующие данные не валидируются
-- ретроспективно (NOT VALID), новые INSERT/UPDATE — да.
-- ============================================================

-- ------------------------------------------------------------
-- C5 — coin_transactions: append-only ledger
-- ------------------------------------------------------------

-- 1) Заменяем админский FOR ALL на SELECT-only.
--    UPDATE/DELETE/INSERT идут только через SECURITY DEFINER функции
--    (add_coins, buy_chapter, etc.). Если админу реально нужно
--    «исправить» запись — он добавляет компенсирующую транзакцию,
--    а не правит существующую.
DROP POLICY IF EXISTS coin_tx_admin_all ON public.coin_transactions;

CREATE POLICY coin_tx_admin_select
  ON public.coin_transactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.is_admin = true OR p.role = 'admin')
    )
  );

-- 2) CHECK на amount.
--    NOT VALID — не валидируем существующие строки (могут быть
--    legacy-нули с давних bug'ов); новые гарантированно проходят.
ALTER TABLE public.coin_transactions
  DROP CONSTRAINT IF EXISTS coin_tx_amount_nonzero;
ALTER TABLE public.coin_transactions
  ADD CONSTRAINT coin_tx_amount_nonzero
  CHECK (amount <> 0) NOT VALID;

ALTER TABLE public.coin_transactions
  DROP CONSTRAINT IF EXISTS coin_tx_amount_bounded;
ALTER TABLE public.coin_transactions
  ADD CONSTRAINT coin_tx_amount_bounded
  CHECK (amount BETWEEN -1000000 AND 1000000) NOT VALID;

-- 3) Дедуп для chapter_purchase: одна и та же глава не может
--    списываться дважды у одного юзера. Это catch-all на случай
--    если buy_chapter когда-нибудь сломается.
--    Условный (partial) уникальный индекс — не валидирует legacy.
CREATE UNIQUE INDEX IF NOT EXISTS coin_tx_chapter_purchase_dedup
  ON public.coin_transactions (user_id, reference_type, reference_id)
  WHERE reason = 'chapter_purchase';

-- ------------------------------------------------------------
-- C6 — marketplace_applications: запрет смены listing_id /
--      applicant_id после INSERT
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_marketplace_app_immutable_keys()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.listing_id IS DISTINCT FROM OLD.listing_id THEN
    RAISE EXCEPTION 'listing_id is immutable on marketplace_applications'
      USING ERRCODE = '42501', HINT = 'create a new application instead';
  END IF;
  IF NEW.applicant_id IS DISTINCT FROM OLD.applicant_id THEN
    RAISE EXCEPTION 'applicant_id is immutable on marketplace_applications'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS marketplace_app_immutable_keys ON public.marketplace_applications;
CREATE TRIGGER marketplace_app_immutable_keys
  BEFORE UPDATE ON public.marketplace_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_marketplace_app_immutable_keys();

-- ============================================================
-- На случай если 081 откатывают: вернуть admin FOR ALL и убрать
-- триггер. CHECK constraints тоже DROP IF EXISTS снимут.
--
--   DROP TRIGGER IF EXISTS marketplace_app_immutable_keys
--     ON public.marketplace_applications;
--   DROP FUNCTION IF EXISTS public.trg_marketplace_app_immutable_keys();
--   ALTER TABLE public.coin_transactions
--     DROP CONSTRAINT IF EXISTS coin_tx_amount_nonzero,
--     DROP CONSTRAINT IF EXISTS coin_tx_amount_bounded;
--   DROP INDEX IF EXISTS public.coin_tx_chapter_purchase_dedup;
--   DROP POLICY IF EXISTS coin_tx_admin_select ON public.coin_transactions;
--   -- (восстановить FOR ALL вручную если действительно нужно)
-- ============================================================
