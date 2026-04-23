-- ============================================================
-- 037: переводчик подключает свои способы оплаты
--
-- Вместо одиночного payout_boosty_url в profiles — полноценная таблица
-- translator_payment_methods: провайдер, ссылка, инструкция, порядок.
-- Можно подключать несколько (Boosty + Tribute + VK Donut).
--
-- Плюс флаг accepts_coins_for_chapters: переводчик может отключить
-- покупку своих платных глав за внутренние монеты chaptify — тогда
-- доступ только через внешние подписки (claim-flow).
--
-- Если юзер отключил монеты:
--   - Chapter paywall скрывает монетную кнопку
--   - Но монеты всё равно принимаются как чаевые (это добровольно)
--
-- Безопасно для tene: новая таблица и новые колонки в profiles,
-- ничего не переписываем из tene-логики.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.translator_payment_methods (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  translator_id  uuid   NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider       text   NOT NULL CHECK (provider IN (
    'boosty', 'tribute', 'vk_donut', 'patreon', 'other'
  )),
  url            text   NOT NULL CHECK (length(url) BETWEEN 1 AND 500),
  instructions   text   CHECK (instructions IS NULL OR length(instructions) <= 500),
  enabled        boolean NOT NULL DEFAULT true,
  sort_order     int    NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_methods_translator
  ON public.translator_payment_methods (translator_id, sort_order)
  WHERE enabled = true;

-- Бэкфилл: для каждого переводчика с payout_boosty_url — одна запись Boosty
INSERT INTO public.translator_payment_methods (translator_id, provider, url, sort_order)
SELECT id, 'boosty', payout_boosty_url, 0
FROM public.profiles
WHERE payout_boosty_url IS NOT NULL
  AND length(trim(payout_boosty_url)) > 0
ON CONFLICT DO NOTHING;

ALTER TABLE public.translator_payment_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pm_read_all      ON public.translator_payment_methods;
DROP POLICY IF EXISTS pm_owner_all     ON public.translator_payment_methods;
DROP POLICY IF EXISTS pm_admin_all     ON public.translator_payment_methods;

-- Публично видимые (нужны для paywall'a у неавторизованных)
CREATE POLICY pm_read_all
  ON public.translator_payment_methods FOR SELECT
  USING (true);

CREATE POLICY pm_owner_all
  ON public.translator_payment_methods FOR ALL
  USING (auth.uid() = translator_id)
  WITH CHECK (auth.uid() = translator_id);

CREATE POLICY pm_admin_all
  ON public.translator_payment_methods FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = true OR role = 'admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = true OR role = 'admin')
  ));

GRANT SELECT                         ON public.translator_payment_methods TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.translator_payment_methods TO authenticated;

-- ============================================================
-- Переключатель «принимаю ли монеты за главы»
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS accepts_coins_for_chapters boolean NOT NULL DEFAULT true;

-- Расширяем update_my_settings — пусть умеет это поле тоже (без
-- слома поведения tene: он этот ключ не передаёт → значение не меняется).
CREATE OR REPLACE FUNCTION public.update_my_settings(data_to_update jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.profiles
  SET
    user_name                = COALESCE(data_to_update->>'user_name',                user_name),
    avatar_url               = COALESCE(data_to_update->>'avatar_url',               avatar_url),
    translator_display_name  = COALESCE(data_to_update->>'translator_display_name',  translator_display_name),
    translator_avatar_url    = COALESCE(data_to_update->>'translator_avatar_url',    translator_avatar_url),
    translator_about         = COALESCE(data_to_update->>'translator_about',         translator_about),
    payout_boosty_url        = COALESCE(data_to_update->>'payout_boosty_url',        payout_boosty_url),
    settings                 = COALESCE(data_to_update->'settings',                  settings),
    quiet_until              = CASE
                                 WHEN data_to_update ? 'quiet_until'
                                   THEN (data_to_update->>'quiet_until')::timestamptz
                                 ELSE quiet_until
                               END,
    quiet_note               = CASE
                                 WHEN data_to_update ? 'quiet_note'
                                   THEN NULLIF(btrim(data_to_update->>'quiet_note'), '')
                                 ELSE quiet_note
                               END,
    accepts_coins_for_chapters = CASE
                                   WHEN data_to_update ? 'accepts_coins_for_chapters'
                                     THEN (data_to_update->>'accepts_coins_for_chapters')::boolean
                                   ELSE accepts_coins_for_chapters
                                 END
  WHERE id = auth.uid();
END $$;

-- View: методы + имя провайдера для удобного SELECT в paywall
CREATE OR REPLACE VIEW public.translator_payment_methods_view AS
SELECT
  pm.id,
  pm.translator_id,
  pm.provider,
  pm.url,
  pm.instructions,
  pm.enabled,
  pm.sort_order,
  pm.created_at,
  p.user_name        AS translator_name,
  p.translator_display_name AS translator_display_name,
  p.avatar_url       AS translator_avatar
FROM public.translator_payment_methods pm
LEFT JOIN public.profiles p ON p.id = pm.translator_id;

ALTER VIEW public.translator_payment_methods_view OWNER TO supabase_admin;
GRANT SELECT ON public.translator_payment_methods_view TO anon, authenticated;
