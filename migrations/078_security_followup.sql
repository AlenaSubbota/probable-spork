-- ============================================================
-- 078: Security follow-up. Закрывает оставшиеся HIGH/MEDIUM из
-- security-аудита (после 077_security_hardening).
--
-- Что делает:
--
--  1. team_members.accepted_at + accept_team_invite RPC
--     Лидер команды мог через invite_to_my_team молча приписать
--     любого юзера себе в команду. После этого приглашённый показывался
--     «членом команды X» в UI и (через can_read_chapter_chaptify)
--     получал бесплатное чтение всех платных глав этой команды.
--     Теперь invite создаёт строку с accepted_at = NULL, и доступ к
--     платному контенту даёт только accepted_at IS NOT NULL.
--     Нужно явно подтвердить приглашение через accept_team_invite RPC.
--
--  2. trg_auto_approve_from_cache: убрана авто-аппрув ветка по name_lc
--     Boosty publicly-displayed name НЕ secret — это просто "Иван
--     Иванов" в профиле. Любой посторонний вписывал в claim
--     external='Иван Иванов' и через триггер получал авто-подписку.
--     Оставляем только email-матчинг (email знает только подписчик).
--
--  3. trg_auto_approve_from_cache: guard на translator_boosty_credentials
--     Если service-role JWT утечёт, INSERT в boosty_subscriber_cache
--     с произвольным translator_id триггерит ложные авто-аппрувы.
--     Требуем чтобы для translator_id существовала строка в
--     translator_boosty_credentials (= переводчик действительно
--     подключал Boosty).
--
--  4. chaptify_subscriptions / subscriptions: BEFORE INSERT/UPDATE
--     триггер с clamp expires_at до now() + 13 months.
--     apply_tribute_event использовал expires_at из payload без upper-
--     bound. При компромете API-key переводчика ('expires_at': '9999')
--     → бесконечная подписка. Триггер — defense-in-depth: clamp
--     применяется ко ВСЕМ путям записи, не только Tribute-вебхукам.
--
--  5. invite_to_my_team пересоздаём так, чтобы новые приглашения
--     шли с accepted_at = NULL. Существующие row-ы помечаем
--     accepted_at = joined_at (грандфатер: то что уже есть, считаем
--     согласованным).
--
--  6. can_read_chapter_chaptify пересоздаём так, чтобы team-доступ
--     к чужому платному контенту давался только accepted_at IS NOT NULL.
-- ============================================================

-- ------------------------------------------------------------
-- 1. team_members.accepted_at
-- ------------------------------------------------------------
ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

-- Грандфатер: всё, что уже было в team_members до этой миграции,
-- считаем accepted (joined_at — дата вступления; если null, fallback
-- на now()).
UPDATE public.team_members
SET accepted_at = COALESCE(joined_at, now())
WHERE accepted_at IS NULL;

-- ------------------------------------------------------------
-- 2. accept_team_invite RPC — для приглашённого юзера
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_team_invite(p_team_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_updated int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  UPDATE public.team_members
  SET accepted_at = now()
  WHERE team_id = p_team_id
    AND user_id = v_uid
    AND accepted_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_pending_invite');
  END IF;

  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.accept_team_invite(bigint) TO authenticated;

-- decline_team_invite — отказаться от приглашения (удаляет строку,
-- если она ещё в pending). Без этого юзер с pending-инвайтом висел бы
-- в UI чужой команды без способа уйти.
CREATE OR REPLACE FUNCTION public.decline_team_invite(p_team_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_deleted int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  DELETE FROM public.team_members
  WHERE team_id = p_team_id
    AND user_id = v_uid
    AND accepted_at IS NULL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_pending_invite');
  END IF;

  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.decline_team_invite(bigint) TO authenticated;

-- ------------------------------------------------------------
-- 3. invite_to_my_team — новые приглашения с accepted_at = NULL.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invite_to_my_team(
  p_team_id      bigint,
  p_user_handle  text,
  p_role         text DEFAULT 'co_translator',
  p_share_percent numeric DEFAULT 0
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_owner_id  uuid;
  v_user_id   uuid;
  v_member_id bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT owner_id INTO v_owner_id FROM public.translator_teams WHERE id = p_team_id;
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'team not found';
  END IF;
  IF v_owner_id <> v_uid THEN
    RAISE EXCEPTION 'only team owner can invite';
  END IF;

  SELECT id INTO v_user_id
  FROM public.profiles
  WHERE translator_slug = p_user_handle OR user_name = p_user_handle
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'user not found: %', p_user_handle;
  END IF;

  -- Owner добавляет себя — сразу принят (это его команда).
  -- Любого другого — pending до accept_team_invite.
  INSERT INTO public.team_members
    (team_id, user_id, role, share_percent, accepted_at)
  VALUES
    (p_team_id, v_user_id, p_role, p_share_percent,
     CASE WHEN v_user_id = v_owner_id THEN now() ELSE NULL END)
  ON CONFLICT (team_id, user_id) DO UPDATE
    SET role = EXCLUDED.role,
        share_percent = EXCLUDED.share_percent
  RETURNING id INTO v_member_id;

  RETURN v_member_id;
END $$;

GRANT EXECUTE ON FUNCTION public.invite_to_my_team(bigint, text, text, numeric)
  TO authenticated;

-- ------------------------------------------------------------
-- 4. can_read_chapter_chaptify — team-доступ требует accepted_at
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_read_chapter_chaptify(
  p_user    uuid,
  p_novel   bigint,
  p_chapter int
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_is_paid      boolean;
  v_translator   uuid;
  v_team_id      bigint;
  v_team_owner   uuid;
  v_early_until  timestamptz;
  v_is_team      boolean := false;
  v_is_admin     boolean := false;
BEGIN
  SELECT c.is_paid, n.translator_id, n.team_id, c.early_access_until
  INTO v_is_paid, v_translator, v_team_id, v_early_until
  FROM public.chapters c
  JOIN public.novels   n ON n.id = c.novel_id
  WHERE c.novel_id = p_novel AND c.chapter_number = p_chapter
  LIMIT 1;

  IF v_team_id IS NOT NULL THEN
    SELECT owner_id INTO v_team_owner
    FROM public.translator_teams
    WHERE id = v_team_id;
  END IF;

  IF p_user IS NOT NULL THEN
    IF p_user = v_translator OR p_user = v_team_owner THEN
      v_is_team := true;
    ELSE
      BEGIN
        SELECT EXISTS (
          SELECT 1 FROM public.novel_translators
          WHERE novel_id = p_novel AND user_id = p_user
        ) INTO v_is_team;
      EXCEPTION WHEN undefined_table THEN
        v_is_team := false;
      END;

      -- Член команды читает бесплатно — НО только если приглашение
      -- принято (accepted_at IS NOT NULL). Иначе любой owner мог бы
      -- молча залить себе в команду чужой UUID и через "принадлежность"
      -- выдавать ему бесплатный premium-контент.
      IF NOT v_is_team AND v_team_id IS NOT NULL THEN
        BEGIN
          SELECT EXISTS (
            SELECT 1 FROM public.team_members
            WHERE team_id = v_team_id
              AND user_id = p_user
              AND accepted_at IS NOT NULL
          ) INTO v_is_team;
        EXCEPTION WHEN undefined_table THEN
          v_is_team := false;
        END;
      END IF;
    END IF;

    SELECT (is_admin = true OR role = 'admin')
    INTO v_is_admin
    FROM public.profiles WHERE id = p_user;
  END IF;

  IF v_is_team OR v_is_admin THEN RETURN true; END IF;

  IF v_early_until IS NOT NULL AND v_early_until > now() THEN
    IF EXISTS (
      SELECT 1 FROM public.chaptify_subscriptions
      WHERE user_id = p_user
        AND translator_id IN (v_translator, v_team_owner)
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > now())
    ) THEN RETURN true; END IF;

    IF EXISTS (
      SELECT 1 FROM public.chapter_purchases
      WHERE user_id = p_user AND novel_id = p_novel AND chapter_number = p_chapter
    ) THEN RETURN true; END IF;

    RETURN false;
  END IF;

  IF NOT v_is_paid THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.chaptify_subscriptions
    WHERE user_id       = p_user
      AND translator_id IN (v_translator, v_team_owner)
      AND status        = 'active'
      AND (expires_at IS NULL OR expires_at > now())
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.chapter_purchases
    WHERE user_id        = p_user
      AND novel_id       = p_novel
      AND chapter_number = p_chapter
  ) THEN RETURN true; END IF;

  RETURN false;
END $$;

GRANT EXECUTE ON FUNCTION public.can_read_chapter_chaptify(uuid, bigint, int)
  TO authenticated, anon;

-- ------------------------------------------------------------
-- 5. trg_auto_approve_from_cache — убираем name_lc, добавляем guard
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_auto_approve_from_cache()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_claim   public.subscription_claims%ROWTYPE;
  v_now     timestamptz := now();
  v_expires timestamptz;
  v_has_creds boolean;
BEGIN
  -- Guard: переводчик действительно подключал Boosty (т.е. credentials
  -- лежат в БД). Иначе любая утечка service-key + INSERT в кэш =
  -- мгновенный апрув всех claim'ов. После guard атака требует ещё и
  -- скомпрометировать сам OAuth-флоу, что уже куда сложнее.
  SELECT EXISTS (
    SELECT 1 FROM public.translator_boosty_credentials
    WHERE translator_id = NEW.translator_id
  ) INTO v_has_creds;
  IF NOT v_has_creds THEN
    RETURN NEW;
  END IF;

  FOR v_claim IN
    SELECT * FROM public.subscription_claims
    WHERE translator_id = NEW.translator_id
      AND status = 'pending'
      AND provider = 'boosty'
      AND COALESCE(kind, 'subscription') = 'subscription'
      AND external_username IS NOT NULL
      -- ТОЛЬКО email-матчинг. name_lc убран: Boosty publicly-displayed
      -- name любой посторонний может вписать в external_username и
      -- получить чужую подписку.
      AND NEW.email_lc <> ''
      AND lower(btrim(external_username)) = NEW.email_lc
  LOOP
    v_expires := v_now + (v_claim.tier_months || ' months')::interval;

    INSERT INTO public.chaptify_subscriptions
      (user_id, translator_id, provider, plan, status, started_at, expires_at)
    VALUES
      (v_claim.user_id, v_claim.translator_id, 'boosty', 'external_claim',
       'active', v_now, v_expires)
    ON CONFLICT (user_id, translator_id, plan, provider) DO UPDATE SET
      status     = 'active',
      expires_at = GREATEST(
        COALESCE(public.chaptify_subscriptions.expires_at, v_now),
        v_now
      ) + (v_claim.tier_months || ' months')::interval;

    UPDATE public.subscription_claims
    SET status = 'approved', reviewed_at = v_now
    WHERE id = v_claim.id;
  END LOOP;

  RETURN NEW;
END $$;

-- ------------------------------------------------------------
-- 6. BEFORE-триггер на subscriptions: clamp expires_at до 13 месяцев
--    Это defense-in-depth: даже если apply_tribute_event прислал
--    'expires_at': '9999-01-01', строка в БД получит now()+13m max.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_clamp_subscription_expires()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_max timestamptz := now() + interval '13 months';
BEGIN
  IF NEW.expires_at IS NOT NULL AND NEW.expires_at > v_max THEN
    NEW.expires_at := v_max;
  END IF;
  RETURN NEW;
END $$;

-- chaptify_subscriptions
DROP TRIGGER IF EXISTS tg_clamp_chaptify_sub_expires ON public.chaptify_subscriptions;
CREATE TRIGGER tg_clamp_chaptify_sub_expires
  BEFORE INSERT OR UPDATE OF expires_at ON public.chaptify_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.trg_clamp_subscription_expires();

-- legacy public.subscriptions (tene) — тоже на всякий
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'subscriptions'
      AND column_name = 'expires_at'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS tg_clamp_sub_expires ON public.subscriptions';
    EXECUTE 'CREATE TRIGGER tg_clamp_sub_expires
              BEFORE INSERT OR UPDATE OF expires_at ON public.subscriptions
              FOR EACH ROW EXECUTE FUNCTION public.trg_clamp_subscription_expires()';
  END IF;
END $$;
