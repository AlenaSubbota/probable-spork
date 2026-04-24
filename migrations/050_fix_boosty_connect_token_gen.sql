-- ============================================================
-- 050: фикс «function gen_random_bytes(integer) does not exist» в
-- issue_boosty_connect_token.
--
-- Классическая грабля Supabase: pgcrypto стоит в схеме `extensions`,
-- а SECURITY DEFINER функция с SET search_path = public, pg_catalog её
-- не видит. Ровно эту же проблему лечили миграцией 027 для payout-
-- токенов — используем то же лекарство: переходим на gen_random_uuid,
-- который лежит в pg_catalog и всегда доступен.
--
-- Длина токена ≈ 32 hex-символа (UUID без дефисов) — меньше, чем
-- было в 049 (base64 от 32 байт = 43 символа), но коллизий за 15 минут
-- TTL всё равно не будет (2^128 пространство).
-- ============================================================

CREATE OR REPLACE FUNCTION public.issue_boosty_connect_token()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me      uuid := auth.uid();
  v_token   text;
  v_expires timestamptz := now() + interval '15 minutes';
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  -- 32 hex-символа из UUID + ещё 32 из второго для большей длины
  -- (не критично, но букмарклет-токен чуть «серьёзнее» визуально)
  v_token := replace(gen_random_uuid()::text, '-', '') ||
             replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.boosty_connect_tokens (token, translator_id, expires_at)
  VALUES (v_token, v_me, v_expires);

  DELETE FROM public.boosty_connect_tokens
  WHERE translator_id = v_me AND expires_at < now() - interval '1 hour';

  RETURN jsonb_build_object(
    'ok',         true,
    'token',      v_token,
    'expires_at', v_expires
  );
END $$;
