-- ============================================================
-- 027: фикс "function gen_random_bytes does not exist" при одобрении
-- заявки в переводчики.
--
-- В миграции 010 триггер trg_ensure_payout_tokens и RPC
-- regenerate_tribute_webhook_token используют gen_random_bytes() из
-- pgcrypto. В Supabase self-hosted pgcrypto часто установлен в схему
-- `extensions`, не `public` — и код в этих функциях её не видит,
-- search_path не включает extensions. При UPDATE profiles.role
-- срабатывает триггер → падает. Админ не может одобрить заявку.
--
-- Лечим двумя путями:
-- 1. Явный SET search_path на функции — чтобы и extensions был виден
-- 2. Переписать генерацию токенов через gen_random_uuid (это core,
--    не требует pgcrypto, всегда доступно)
-- ============================================================

-- Триггер: генерация токенов без pgcrypto, через UUID (работает в любом
-- self-hosted Supabase, независимо от того, в какой схеме pgcrypto).
-- Формат: 32 hex-символа (uuid без дефисов) для токена, 64 для секрета.
CREATE OR REPLACE FUNCTION public.trg_ensure_payout_tokens()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF (NEW.role = 'translator' OR NEW.role = 'admin' OR NEW.is_admin = true)
     AND NEW.payout_tribute_webhook_token IS NULL THEN
    NEW.payout_tribute_webhook_token :=
      replace(gen_random_uuid()::text, '-', '');
    NEW.payout_tribute_secret :=
      replace(gen_random_uuid()::text, '-', '') ||
      replace(gen_random_uuid()::text, '-', '');
  END IF;
  RETURN NEW;
END $$;

-- RPC для ручной ротации токена — тоже без pgcrypto
CREATE OR REPLACE FUNCTION public.regenerate_tribute_webhook_token()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_token  text;
  v_secret text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND (role IN ('translator', 'admin') OR is_admin = true)
  ) THEN
    RAISE EXCEPTION 'not a translator';
  END IF;

  v_token  := replace(gen_random_uuid()::text, '-', '');
  v_secret := replace(gen_random_uuid()::text, '-', '') ||
              replace(gen_random_uuid()::text, '-', '');

  UPDATE public.profiles
  SET payout_tribute_webhook_token = v_token,
      payout_tribute_secret        = v_secret
  WHERE id = auth.uid();

  RETURN jsonb_build_object('token', v_token, 'secret', v_secret);
END $$;

GRANT EXECUTE ON FUNCTION public.regenerate_tribute_webhook_token TO authenticated;
