-- ============================================================
-- 035: claim-flow для внешних подписок (Boosty, etc.) + мелкие фиксы
--
-- Модель «chaptify без финпосредничества»: читатель платит напрямую
-- переводчику на Boosty (или другом канале), потом на chaptify
-- отправляет заявку «я подписался(ась) — вот мой код/ник». Переводчик
-- сверяет со своим списком подписчиков и одобряет. Одобрение создаёт
-- запись в subscriptions — дальше can_read_chapter пропускает.
--
-- Никакие деньги не проходят через chaptify.
--
-- Плюс фикс: view novel_credits получает created_at колонку, которой
-- требовал CreditsEditor при сортировке.
-- ============================================================

-- Пересоздаём view с created_at
CREATE OR REPLACE VIEW public.novel_credits AS
SELECT
  nt.id,
  nt.novel_id,
  nt.user_id,
  nt.role,
  nt.share_percent,
  nt.note,
  nt.sort_order,
  nt.created_at,
  p.user_name        AS user_name,
  p.avatar_url       AS avatar_url,
  p.translator_slug  AS translator_slug,
  p.translator_display_name AS display_name
FROM public.novel_translators nt
LEFT JOIN public.profiles p ON p.id = nt.user_id;

ALTER VIEW public.novel_credits OWNER TO supabase_admin;
GRANT SELECT ON public.novel_credits TO anon, authenticated;

-- ============================================================
-- subscription_claims — заявки «я оплатил Boosty-подписку»
-- ============================================================
CREATE TABLE IF NOT EXISTS public.subscription_claims (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           uuid   NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  translator_id     uuid   NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider          text   NOT NULL DEFAULT 'boosty'
                      CHECK (provider IN ('boosty', 'tribute', 'vk_donut', 'other')),
  code              text   NOT NULL,            -- уникальный короткий код, показанный юзеру
  external_username text   CHECK (external_username IS NULL OR length(external_username) <= 120),
  note              text   CHECK (note IS NULL OR length(note) <= 500),
  status            text   NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'declined')),
  decline_reason    text   CHECK (decline_reason IS NULL OR length(decline_reason) <= 300),
  tier_months       int    NOT NULL DEFAULT 1 CHECK (tier_months BETWEEN 1 AND 12),
  created_at        timestamptz NOT NULL DEFAULT now(),
  reviewed_at       timestamptz,
  CONSTRAINT claim_not_self CHECK (user_id <> translator_id)
);

-- Нельзя иметь два pending-claim на одного переводчика
CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_unique_pending
  ON public.subscription_claims (user_id, translator_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_claims_translator_status
  ON public.subscription_claims (translator_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_claims_user
  ON public.subscription_claims (user_id, created_at DESC);

ALTER TABLE public.subscription_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS claims_self_read        ON public.subscription_claims;
DROP POLICY IF EXISTS claims_translator_read  ON public.subscription_claims;
DROP POLICY IF EXISTS claims_admin_all        ON public.subscription_claims;

-- Читатель видит свои claims
CREATE POLICY claims_self_read
  ON public.subscription_claims FOR SELECT
  USING (auth.uid() = user_id);

-- Переводчик видит адресованные ему
CREATE POLICY claims_translator_read
  ON public.subscription_claims FOR SELECT
  USING (auth.uid() = translator_id);

-- Админ — всё
CREATE POLICY claims_admin_all
  ON public.subscription_claims FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = true OR role = 'admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = true OR role = 'admin')
  ));

-- Прямые INSERT / UPDATE / DELETE с клиента запрещены — только через RPC.
-- SELECT через policy, остальное — service_definer.
REVOKE INSERT, UPDATE, DELETE ON public.subscription_claims FROM authenticated;
GRANT  SELECT ON public.subscription_claims TO authenticated;

-- ============================================================
-- RPC: создать заявку
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

  -- Если есть pending-claim на этого переводчика — возвращаем его (идемпотентно)
  SELECT id INTO v_existing_id
  FROM public.subscription_claims
  WHERE user_id = v_user
    AND translator_id = p_translator_id
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

  -- Генерируем короткий читаемый код: C-XXXXXXXX (8 hex)
  v_code := 'C-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  INSERT INTO public.subscription_claims
    (user_id, translator_id, provider, code, external_username, note, tier_months)
  VALUES
    (v_user, p_translator_id, COALESCE(p_provider, 'boosty'), v_code,
     NULLIF(btrim(COALESCE(p_external, '')), ''),
     NULLIF(btrim(COALESCE(p_note, '')), ''),
     p_tier_months)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'claim', row_to_json(v_row));
END $$;

GRANT EXECUTE ON FUNCTION public.submit_subscription_claim(uuid, text, text, text, int) TO authenticated;

-- ============================================================
-- RPC: одобрить заявку. Только автор (translator) или админ.
-- При успехе создаёт/продлевает запись в subscriptions.
-- ============================================================
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

  v_expires := v_now + (v_claim.tier_months || ' months')::interval;

  -- Создаём/продлеваем подписку. subscriptions UNIQUE по (user, translator,
  -- plan, provider) — используем plan='external_claim' для всех claim-подписок,
  -- provider = тот что в claim.
  INSERT INTO public.subscriptions
    (user_id, translator_id, provider, plan, status, started_at, expires_at)
  VALUES
    (v_claim.user_id, v_claim.translator_id, v_claim.provider,
     'external_claim', 'active', v_now, v_expires)
  ON CONFLICT (user_id, translator_id, plan, provider) DO UPDATE SET
    status     = 'active',
    -- Если подписка ещё активна, прибавляем срок поверх. Если истекла,
    -- начинаем отсчёт от now().
    expires_at = GREATEST(
      COALESCE(public.subscriptions.expires_at, v_now),
      v_now
    ) + (v_claim.tier_months || ' months')::interval;

  UPDATE public.subscription_claims
  SET status = 'approved', reviewed_at = v_now
  WHERE id = p_claim_id;

  RETURN jsonb_build_object('ok', true, 'expires_at', v_expires);
END $$;

GRANT EXECUTE ON FUNCTION public.approve_subscription_claim(bigint) TO authenticated;

-- ============================================================
-- RPC: отклонить заявку
-- ============================================================
CREATE OR REPLACE FUNCTION public.decline_subscription_claim(
  p_claim_id bigint,
  p_reason   text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me        uuid := auth.uid();
  v_claim     public.subscription_claims%ROWTYPE;
  v_is_admin  boolean := false;
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

  UPDATE public.subscription_claims
  SET status = 'declined',
      decline_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''),
      reviewed_at = now()
  WHERE id = p_claim_id;

  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.decline_subscription_claim(bigint, text) TO authenticated;

-- ============================================================
-- View: заявки с данными читателя + переводчика для рендера
-- ============================================================
CREATE OR REPLACE VIEW public.subscription_claims_view AS
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
  c.created_at,
  c.reviewed_at,
  u.user_name    AS user_name,
  u.avatar_url   AS user_avatar,
  t.user_name    AS translator_name,
  t.translator_display_name AS translator_display_name,
  t.avatar_url   AS translator_avatar,
  t.translator_slug AS translator_slug,
  t.payout_boosty_url AS translator_boosty_url
FROM public.subscription_claims c
LEFT JOIN public.profiles u ON u.id = c.user_id
LEFT JOIN public.profiles t ON t.id = c.translator_id;

ALTER VIEW public.subscription_claims_view OWNER TO supabase_admin;
GRANT SELECT ON public.subscription_claims_view TO authenticated;

-- ============================================================
-- Триггеры уведомлений
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_notify_subscription_claim()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_name text;
BEGIN
  SELECT COALESCE(user_name, 'Читатель') INTO v_user_name
  FROM public.profiles WHERE id = NEW.user_id;

  INSERT INTO public.notifications
    (user_id, type, text, target_url, actor_id, group_key)
  VALUES
    (NEW.translator_id,
     'subscription_claim',
     v_user_name || ' заявил_а подписку через ' || NEW.provider,
     '/admin/subscribers',
     NEW.user_id,
     'sub_claim:' || NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_subscription_claim ON public.subscription_claims;
CREATE TRIGGER on_subscription_claim
  AFTER INSERT ON public.subscription_claims
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_subscription_claim();

CREATE OR REPLACE FUNCTION public.trg_notify_claim_reviewed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_translator_name text;
  v_text            text;
BEGIN
  IF NEW.status NOT IN ('approved', 'declined') THEN RETURN NEW; END IF;
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  SELECT COALESCE(translator_display_name, user_name, 'Переводчик')
  INTO v_translator_name
  FROM public.profiles WHERE id = NEW.translator_id;

  IF NEW.status = 'approved' THEN
    v_text := 'Подписка подтверждена: ' || v_translator_name ||
              ' открыл_а тебе доступ на ' || NEW.tier_months || ' мес.';
  ELSE
    v_text := 'Подписка отклонена: ' || v_translator_name ||
              COALESCE(' — ' || NEW.decline_reason, '');
  END IF;

  INSERT INTO public.notifications
    (user_id, type, text, target_url, actor_id, group_key)
  VALUES
    (NEW.user_id,
     CASE NEW.status WHEN 'approved' THEN 'subscription_approved'
                     ELSE 'subscription_declined' END,
     v_text,
     '/profile/subscriptions',
     NEW.translator_id,
     'sub_claim_review:' || NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_claim_reviewed ON public.subscription_claims;
CREATE TRIGGER on_claim_reviewed
  AFTER UPDATE OF status ON public.subscription_claims
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_claim_reviewed();
