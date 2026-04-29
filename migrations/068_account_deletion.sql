-- ============================================================
-- 068: пользовательский запрос на удаление аккаунта
--
-- На стороне Chaptify даём юзеру кнопку «Удалить аккаунт». Клиент
-- НЕ может сам убить запись в auth.users — для этого нужен
-- service_role. Поэтому делаем soft-delete:
--   1) фиксируем запрос в account_deletion_requests;
--   2) сразу анонимизируем видимые поля профиля (имя, аватар,
--      описание и т.п.) — другим пользователям этот аккаунт
--      моментально превращается в «[удалён]»;
--   3) приостанавливаем активные chaptify-подписки, чтобы
--      переводчики ничего не теряли в учёте;
--   4) хард-удаление из auth.users делает админ позже (через
--      service_role tooling) или 30-дневный воркер.
--
-- Соответствует обещаниям /privacy: имя/аватар/комментарии-метаданные
-- удаляются сразу; платёжные записи живут 3 года для налоговой;
-- бэкап ещё 30 дней «корзины».
-- ============================================================

CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  reason         text,
  -- 'pending' = ждёт хард-удаления, 'cancelled' = пользователь
  -- передумал в течение 30 дней, 'completed' = auth.users тоже
  -- удалён (выполнено админом / воркером).
  status         text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'cancelled', 'completed')),
  completed_at   timestamptz,
  cancelled_at   timestamptz,
  -- Что было до анонимизации — на случай отмены в течение 30 дней.
  -- Хранятся отдельной jsonb-снимком, не используются ни для каких
  -- публичных запросов.
  snapshot       jsonb
);

CREATE INDEX IF NOT EXISTS idx_adr_status_requested
  ON public.account_deletion_requests (status, requested_at);

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS adr_self_select ON public.account_deletion_requests;
DROP POLICY IF EXISTS adr_admin_all   ON public.account_deletion_requests;

CREATE POLICY adr_self_select
  ON public.account_deletion_requests FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY adr_admin_all
  ON public.account_deletion_requests FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (role = 'admin' OR COALESCE(is_admin, false) = true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (role = 'admin' OR COALESCE(is_admin, false) = true)
    )
  );

GRANT SELECT ON public.account_deletion_requests TO authenticated;

-- ------------------------------------------------------------
-- RPC: request_my_account_deletion
-- Принимает текстовое подтверждение (юзер вводит свой ник —
-- защита от случайного клика). Анонимизирует профиль и роняет
-- активные подписки в paused.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.request_my_account_deletion(
  p_confirm_text text,
  p_reason       text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me        uuid := auth.uid();
  v_profile   record;
  v_snapshot  jsonb;
  v_anon_name text;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
  END IF;

  -- Если уже есть pending-запрос — просто отдаём текущий статус,
  -- не плодим дубликаты.
  IF EXISTS (
    SELECT 1 FROM public.account_deletion_requests
    WHERE user_id = v_me AND status = 'pending'
  ) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_requested', true
    );
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = v_me;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = '02000';
  END IF;

  -- Подтверждение: должно совпасть с user_name (без учёта регистра).
  -- Нет user_name → принимаем «удалить» как вторую возможную фразу.
  IF NOT (
    lower(btrim(p_confirm_text)) = lower(coalesce(v_profile.user_name, ''))
    OR lower(btrim(p_confirm_text)) = 'удалить'
  ) THEN
    RAISE EXCEPTION 'confirm text mismatch' USING ERRCODE = '22023';
  END IF;

  -- Снимок «до» — в JSONB, ровно те поля, которые будем затирать.
  v_snapshot := jsonb_build_object(
    'user_name',                v_profile.user_name,
    'avatar_url',               v_profile.avatar_url,
    'translator_display_name',  v_profile.translator_display_name,
    'translator_avatar_url',    v_profile.translator_avatar_url,
    'translator_about',         v_profile.translator_about,
    'payout_boosty_url',        v_profile.payout_boosty_url,
    'telegram_id',              v_profile.telegram_id
  );

  -- Анонимизируем: имя превращаем в «[удалён-XXXX]», где XXXX —
  -- короткий хэш id. Так в комментариях/ленте этот участник
  -- остаётся отличим от других «[удалён]» (для модератора), но
  -- сам не идентифицируется.
  v_anon_name := '[удалён-' || substr(replace(v_me::text, '-', ''), 1, 4) || ']';

  -- Прямой UPDATE на profiles: SECURITY DEFINER позволяет нам
  -- обойти RLS «только своё», как и в update_my_profile.
  UPDATE public.profiles
  SET
    user_name               = v_anon_name,
    avatar_url              = NULL,
    translator_display_name = NULL,
    translator_avatar_url   = NULL,
    translator_about        = NULL,
    payout_boosty_url       = NULL,
    -- Телеграм-связку тоже сбрасываем — иначе через TG-логин
    -- человек случайно «вернётся» в анонимизированный аккаунт.
    telegram_id             = NULL
  WHERE id = v_me;

  -- Активные подписки на чужой контент: переводим в 'cancelled'
  -- — переводчик увидит «отмена по запросу читателя». Платёжные
  -- записи не трогаем (нужны 3 года для налоговой).
  BEGIN
    UPDATE public.chaptify_subscriptions
    SET status = 'cancelled'
    WHERE user_id = v_me AND status = 'active';
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  -- Помечаем все комментарии пользователя анонимом — чтобы ник
  -- внутри комментариев тоже не висел старый. Текст не трогаем
  -- (моделирование «не подгладывать в чужие сообщения»).
  BEGIN
    UPDATE public.comments
    SET user_name = v_anon_name,
        user_avatar = NULL
    WHERE user_id = v_me;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    NULL;
  END;

  -- Личные сообщения тоже подменяем имя отправителя.
  BEGIN
    UPDATE public.dm_messages
    SET sender_name = v_anon_name
    WHERE sender_id = v_me;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    NULL;
  END;

  -- Регистрируем запрос (после анонимизации, чтобы при ошибке
  -- посередине не остаться с «висячим» request'ом).
  INSERT INTO public.account_deletion_requests
    (user_id, reason, snapshot)
  VALUES (v_me, btrim(p_reason), v_snapshot);

  RETURN jsonb_build_object(
    'ok', true,
    'already_requested', false,
    'anonymized_name', v_anon_name
  );
END $$;

REVOKE ALL    ON FUNCTION public.request_my_account_deletion(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_my_account_deletion(text, text) TO authenticated;

-- ------------------------------------------------------------
-- Маленькая справка для UI: есть ли уже запрос на удаление.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_deletion_status()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me  uuid := auth.uid();
  v_row public.account_deletion_requests%ROWTYPE;
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  SELECT * INTO v_row
  FROM public.account_deletion_requests
  WHERE user_id = v_me
    AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'pending', false);
  END IF;

  RETURN jsonb_build_object(
    'ok',           true,
    'pending',      true,
    'requested_at', v_row.requested_at
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_my_deletion_status() TO authenticated;
