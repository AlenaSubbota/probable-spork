-- ============================================================
-- Миграция 010: webhook-токены для выплат переводчиков
-- Каждому переводчику — свой уникальный токен. По нему вебхук
-- Tribute находит нужного переводчика и начисляет монеты его
-- читателям.
-- Безопасно для tene.fun: только ADD COLUMN IF NOT EXISTS.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS payout_tribute_webhook_token text,
  ADD COLUMN IF NOT EXISTS payout_tribute_secret        text,
  ADD COLUMN IF NOT EXISTS payout_last_tribute_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS payout_boosty_url            text,
  ADD COLUMN IF NOT EXISTS payout_boosty_cookies_enc    text,
  ADD COLUMN IF NOT EXISTS payout_last_boosty_sync_at   timestamptz;

-- Генерируем токены всем существующим переводчикам, у кого их ещё нет.
-- Используем 24 байта случайности → base64url без паддинга ≈ 32 символа.
-- Формат из gen_random_bytes доступен из pgcrypto.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

UPDATE public.profiles
SET
  payout_tribute_webhook_token = encode(gen_random_bytes(18), 'base64'),
  payout_tribute_secret        = encode(gen_random_bytes(32), 'base64')
WHERE
  payout_tribute_webhook_token IS NULL
  AND (role IN ('translator', 'admin') OR is_admin = true);

-- Нормализуем токены (base64 может содержать '+' '/' '='). Заменяем на url-safe
UPDATE public.profiles
SET payout_tribute_webhook_token = translate(payout_tribute_webhook_token, '+/=', '-_')
WHERE payout_tribute_webhook_token LIKE '%+%'
   OR payout_tribute_webhook_token LIKE '%/%'
   OR payout_tribute_webhook_token LIKE '%=%';

-- Индекс для быстрого поиска переводчика по токену в вебхуке
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_payout_tribute_token
  ON public.profiles (payout_tribute_webhook_token)
  WHERE payout_tribute_webhook_token IS NOT NULL;

-- Триггер: при назначении role='translator' генерируем токены, если их ещё нет
CREATE OR REPLACE FUNCTION public.trg_ensure_payout_tokens()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.role = 'translator' OR NEW.role = 'admin' OR NEW.is_admin = true)
     AND NEW.payout_tribute_webhook_token IS NULL THEN
    NEW.payout_tribute_webhook_token :=
      translate(encode(gen_random_bytes(18), 'base64'), '+/=', '-_');
    NEW.payout_tribute_secret :=
      translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ensure_payout_tokens_tg ON public.profiles;
CREATE TRIGGER ensure_payout_tokens_tg
  BEFORE INSERT OR UPDATE OF role, is_admin ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_ensure_payout_tokens();

-- RPC: перегенерировать webhook token (на случай утечки)
CREATE OR REPLACE FUNCTION public.regenerate_tribute_webhook_token()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_token  text;
  v_secret text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- Только переводчик/админ может
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND (role IN ('translator', 'admin') OR is_admin = true)
  ) THEN
    RAISE EXCEPTION 'not a translator';
  END IF;

  v_token  := translate(encode(gen_random_bytes(18), 'base64'), '+/=', '-_');
  v_secret := translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_');

  UPDATE public.profiles
  SET payout_tribute_webhook_token = v_token,
      payout_tribute_secret        = v_secret
  WHERE id = auth.uid();

  RETURN jsonb_build_object('token', v_token, 'secret', v_secret);
END $$;

GRANT EXECUTE ON FUNCTION public.regenerate_tribute_webhook_token TO authenticated;

-- RPC: для бота — найти переводчика по токену и (опционально) его секрет.
-- Используется из FastAPI webhook-обработчика в my-bot.
CREATE OR REPLACE FUNCTION public.get_translator_by_webhook_token(p_token text)
RETURNS TABLE (translator_id uuid, secret text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id, payout_tribute_secret
  FROM public.profiles
  WHERE payout_tribute_webhook_token = p_token
  LIMIT 1;
$$;

-- Выдаём право только service_role (бот ходит под ним)
GRANT EXECUTE ON FUNCTION public.get_translator_by_webhook_token TO service_role;

-- RPC для переводчика: отметить момент последнего успешного вебхука
-- Зовёт бот через service_role после успешной обработки события.
CREATE OR REPLACE FUNCTION public.mark_tribute_event(p_translator uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.profiles
  SET payout_last_tribute_event_at = now()
  WHERE id = p_translator;
$$;

GRANT EXECUTE ON FUNCTION public.mark_tribute_event TO service_role;
