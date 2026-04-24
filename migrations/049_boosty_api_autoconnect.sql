-- ============================================================
-- 049: автосинк Boosty через API (букмарклет → токены переводчика)
--
-- Цель: переводчик один раз «подключает» свой Boosty-аккаунт (через
-- букмарклет, который читает localStorage и шлёт токены нам), после
-- чего бэкграунд-воркер раз в ~15 минут тянет его полный список
-- подписчиков через api.boosty.to и кэширует в boosty_subscriber_cache.
-- Когда читатель оставляет заявку с Boosty-email/ник — заявка
-- автоматически одобряется, если есть совпадение в кэше.
--
-- Три новые сущности:
--   1) translator_boosty_credentials — зашифрованные access/refresh-токены
--      переводчика. Ключ шифрования BOOSTY_CREDS_KEY живёт в ENV у
--      auth-service и воркера. Доступ только у service_role (через
--      REVOKE + отсутствие RLS-политик для authenticated).
--   2) boosty_connect_tokens — одноразовые токены для букмарклета.
--      Нужны, чтобы бэкенд понял, что POST с boosty.to к нам относится
--      к конкретному переводчику, залогиненному на chaptify.
--   3) boosty_subscriber_cache — дамп подписчиков конкретного блога,
--      обновляется воркером. Строки ищутся по lower(email) или
--      lower(name) при обработке заявки.
--
-- Плюс: submit_subscription_claim теперь до INSERT'a заглядывает в
-- кэш и, если совпадение есть, сразу создаёт claim со status='approved'
-- и продляет подписку. Без кэша — текущий pending-флоу.
--
-- Безопасно для tene: новые таблицы/RPC, ничего из tene-логики не
-- переписываем. Изменение submit_subscription_claim ведёт себя
-- идентично при пустом кэше.
-- ============================================================

-- pgcrypto уже включён миграцией 010 — но на всякий случай.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1) translator_boosty_credentials
-- ============================================================
CREATE TABLE IF NOT EXISTS public.translator_boosty_credentials (
  translator_id      uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  access_token_enc   bytea NOT NULL,   -- AES-256-GCM (iv||ct||tag)
  refresh_token_enc  bytea NOT NULL,
  client_id          text  NOT NULL,   -- он же device_id для refresh-запроса
  blog_username      text,             -- выясняется авто-сервисом после подключения
  token_expires_at   timestamptz,      -- когда истекает access_token
  last_synced_at     timestamptz,      -- последний успешный скан подписчиков
  last_sync_error    text,             -- если last_synced_at старше 30 мин — повод разлогинить
  subscribers_count  int   NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Полностью запрещаем клиентам читать/писать. Работает только service_role
-- (он обходит RLS). У owner'а будет RPC get_my_boosty_connection_status().
ALTER TABLE public.translator_boosty_credentials ENABLE ROW LEVEL SECURITY;
-- Никаких политик — значит authenticated не видит ничего.

REVOKE ALL ON public.translator_boosty_credentials FROM anon, authenticated;

-- ============================================================
-- 2) boosty_connect_tokens — одноразовый токен для букмарклета
-- ============================================================
CREATE TABLE IF NOT EXISTS public.boosty_connect_tokens (
  token          text PRIMARY KEY,
  translator_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  expires_at     timestamptz NOT NULL,
  consumed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_boosty_connect_tokens_translator
  ON public.boosty_connect_tokens (translator_id, expires_at DESC);

ALTER TABLE public.boosty_connect_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.boosty_connect_tokens FROM anon, authenticated;

-- ============================================================
-- 3) boosty_subscriber_cache — «кто сейчас подписчик у кого»
-- ============================================================
CREATE TABLE IF NOT EXISTS public.boosty_subscriber_cache (
  translator_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  email_lc           text NOT NULL DEFAULT '',  -- может быть пустым, если у Boosty нет email
  name_lc            text NOT NULL DEFAULT '',
  boosty_user_id     bigint,                    -- внутренний id подписчика на Boosty
  level_name         text,
  level_price        numeric(12, 2),
  subscribed_until   timestamptz,
  synced_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (translator_id, boosty_user_id)
);

-- Поиск по email/имени — самое частое обращение (из триггера)
CREATE INDEX IF NOT EXISTS idx_boosty_cache_email
  ON public.boosty_subscriber_cache (translator_id, email_lc)
  WHERE email_lc <> '';

CREATE INDEX IF NOT EXISTS idx_boosty_cache_name
  ON public.boosty_subscriber_cache (translator_id, name_lc)
  WHERE name_lc <> '';

ALTER TABLE public.boosty_subscriber_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.boosty_subscriber_cache FROM anon, authenticated;

-- ============================================================
-- RPC: выдать одноразовый connect_token для букмарклета
-- Вызывается переводчиком из /profile/settings.
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

  -- url-safe base64 без паддинга, длина ~43 символа
  v_token := translate(encode(gen_random_bytes(32), 'base64'), '+/=', '-_');
  v_token := replace(v_token, E'\n', '');

  INSERT INTO public.boosty_connect_tokens (token, translator_id, expires_at)
  VALUES (v_token, v_me, v_expires);

  -- Подчищаем старые токены этого же переводчика, чтобы не копились.
  DELETE FROM public.boosty_connect_tokens
  WHERE translator_id = v_me AND expires_at < now() - interval '1 hour';

  RETURN jsonb_build_object(
    'ok',         true,
    'token',      v_token,
    'expires_at', v_expires
  );
END $$;

REVOKE ALL ON FUNCTION public.issue_boosty_connect_token() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_boosty_connect_token() TO authenticated;

-- ============================================================
-- RPC: consume connect_token — auth-service использует это, чтобы
-- понять, какому переводчику соответствует токен из букмарклета.
-- Service-role-only.
-- ============================================================
CREATE OR REPLACE FUNCTION public.consume_boosty_connect_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row public.boosty_connect_tokens%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(p_token) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_token');
  END IF;

  SELECT * INTO v_row
  FROM public.boosty_connect_tokens
  WHERE token = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_row.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_consumed');
  END IF;
  IF v_row.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  UPDATE public.boosty_connect_tokens
  SET consumed_at = now()
  WHERE token = p_token;

  RETURN jsonb_build_object(
    'ok',            true,
    'translator_id', v_row.translator_id
  );
END $$;

REVOKE ALL ON FUNCTION public.consume_boosty_connect_token(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.consume_boosty_connect_token(text) TO service_role;

-- ============================================================
-- RPC: статус подключения (для UI переводчика).
-- Безопасно — отдаёт только non-sensitive поля.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_my_boosty_connection_status()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me  uuid := auth.uid();
  v_row public.translator_boosty_credentials%ROWTYPE;
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_row
  FROM public.translator_boosty_credentials
  WHERE translator_id = v_me;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'connected', false);
  END IF;

  RETURN jsonb_build_object(
    'ok',                true,
    'connected',         true,
    'blog_username',     v_row.blog_username,
    'last_synced_at',    v_row.last_synced_at,
    'last_sync_error',   v_row.last_sync_error,
    'subscribers_count', v_row.subscribers_count,
    'created_at',        v_row.created_at
  );
END $$;

REVOKE ALL ON FUNCTION public.get_my_boosty_connection_status() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_boosty_connection_status() TO authenticated;

-- ============================================================
-- RPC: отвязать Boosty (удалить creds).
-- ============================================================
CREATE OR REPLACE FUNCTION public.disconnect_my_boosty()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  DELETE FROM public.translator_boosty_credentials WHERE translator_id = v_me;
  DELETE FROM public.boosty_subscriber_cache       WHERE translator_id = v_me;

  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.disconnect_my_boosty() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.disconnect_my_boosty() TO authenticated;

-- ============================================================
-- Переопределяем submit_subscription_claim:
-- перед INSERT'ом ищем совпадение в boosty_subscriber_cache; если есть —
-- сразу INSERT c approved и продление subscriptions.
-- Если нет — стандартный pending-флоу.
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

  -- Идемпотентность: pending-заявка уже есть
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

  -- Пытаемся автоподтвердить через Boosty-кэш. Только для provider='boosty'
  -- и если пользователь дал хоть какой-то identifier.
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

    INSERT INTO public.subscriptions
      (user_id, translator_id, provider, plan, status, started_at, expires_at)
    VALUES
      (v_user, p_translator_id, 'boosty', 'external_claim', 'active', v_now, v_expires)
    ON CONFLICT (user_id, translator_id, plan, provider) DO UPDATE SET
      status     = 'active',
      expires_at = GREATEST(
        COALESCE(public.subscriptions.expires_at, v_now),
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

-- GRANT уже был выдан в миграции 035 (authenticated) — сохраняем.

-- ============================================================
-- Переключаем триггер уведомления переводчика: срабатывает только
-- на pending-заявки. Авто-одобренные сразу идут на reader-notify.
-- ============================================================
DROP TRIGGER IF EXISTS on_subscription_claim ON public.subscription_claims;
CREATE TRIGGER on_subscription_claim
  AFTER INSERT ON public.subscription_claims
  FOR EACH ROW
  WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION public.trg_notify_subscription_claim();

-- Для авто-одобренных заявок хотим отправить читателю «подписка активна».
-- Триггер on_claim_reviewed фиксирует UPDATE OF status — а мы сразу
-- вставляем approved. Добавляем AFTER INSERT-зеркало.
CREATE OR REPLACE FUNCTION public.trg_notify_claim_auto_approved()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_translator_name text;
BEGIN
  IF NEW.status <> 'approved' THEN RETURN NEW; END IF;

  SELECT COALESCE(translator_display_name, user_name, 'Переводчик')
  INTO v_translator_name
  FROM public.profiles WHERE id = NEW.translator_id;

  INSERT INTO public.notifications
    (user_id, type, text, target_url, actor_id, group_key)
  VALUES
    (NEW.user_id,
     'subscription_approved',
     'Подписка подтверждена: ' || v_translator_name ||
       ' (через Boosty-автосинк, на ' || NEW.tier_months || ' мес.)',
     '/profile/subscriptions',
     NEW.translator_id,
     'sub_claim_review:' || NEW.id);

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_claim_auto_approved ON public.subscription_claims;
CREATE TRIGGER on_claim_auto_approved
  AFTER INSERT ON public.subscription_claims
  FOR EACH ROW
  WHEN (NEW.status = 'approved')
  EXECUTE FUNCTION public.trg_notify_claim_auto_approved();

-- ============================================================
-- Триггер на кэш: когда воркер добавил нового подписчика, сверяем
-- его с pending-заявками на этого переводчика. Нашёлся матч → апдейт
-- статуса на 'approved' (всё остальное, включая subscriptions, делает
-- on_claim_reviewed + approve RPC... нет — approve RPC требует auth.uid).
-- Проще: прямо в триггере делаем INSERT в subscriptions и UPDATE claim.
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_auto_approve_from_cache()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_claim  public.subscription_claims%ROWTYPE;
  v_now    timestamptz := now();
  v_expires timestamptz;
BEGIN
  -- Ищем pending-заявку на этого переводчика, где identifier совпадает
  FOR v_claim IN
    SELECT * FROM public.subscription_claims
    WHERE translator_id = NEW.translator_id
      AND status = 'pending'
      AND provider = 'boosty'
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
    -- on_claim_reviewed триггер сам отправит уведомление читателю.
  END LOOP;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_boosty_cache_upsert ON public.boosty_subscriber_cache;
CREATE TRIGGER on_boosty_cache_upsert
  AFTER INSERT OR UPDATE ON public.boosty_subscriber_cache
  FOR EACH ROW EXECUTE FUNCTION public.trg_auto_approve_from_cache();
