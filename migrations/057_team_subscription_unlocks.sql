-- ============================================================
-- 057: подписка на команду открывает ВСЕ её новеллы
--
-- Раньше can_read_chapter_chaptify (мигр. 054) сверял подписку только
-- с translator_id текущей новеллы. Это значило: подписался на лидера
-- — открыл ровно те новеллы, у которых translator_id = лидер. А если
-- в команде у Маши новелла №1, у Лиды новелла №2 (разный translator_id),
-- но обе принадлежат одной команде, читатель должен был подписываться
-- ОТДЕЛЬНО на каждую — это не команда, а сборище одиночек.
--
-- Чинится логично: если у новеллы есть team_id, то подписка на
-- ВЛАДЕЛЬЦА команды (translator_teams.owner_id) открывает её главу.
-- Бренд один — счёт один — подписка одна. Лидер делит сам, как и
-- договорились в дизайне 056.
--
-- Совместимость: если team_id = NULL (старая модель), всё работает как
-- было. tene не ломается — он зовёт public.can_read_chapter, мы её не
-- трогаем.
-- ============================================================

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

  -- Если новелла привязана к команде — подтянем владельца. Подписка на
  -- него (или на translator_id) считается одинаково за «подписку на бренд».
  IF v_team_id IS NOT NULL THEN
    SELECT owner_id INTO v_team_owner
    FROM public.translator_teams
    WHERE id = v_team_id;
  END IF;

  -- Команда новеллы / автор / админ читают бесплатно.
  IF p_user IS NOT NULL THEN
    IF p_user = v_translator OR p_user = v_team_owner THEN
      v_is_team := true;
    ELSE
      -- 1) per-novel роль (novel_translators, мигр. 034)
      BEGIN
        SELECT EXISTS (
          SELECT 1 FROM public.novel_translators
          WHERE novel_id = p_novel AND user_id = p_user
        ) INTO v_is_team;
      EXCEPTION WHEN undefined_table THEN
        v_is_team := false;
      END;

      -- 2) член команды этой новеллы (team_members, мигр. 056) тоже
      --    читает бесплатно — это его коллектив-бренд.
      IF NOT v_is_team AND v_team_id IS NOT NULL THEN
        BEGIN
          SELECT EXISTS (
            SELECT 1 FROM public.team_members
            WHERE team_id = v_team_id AND user_id = p_user
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

  -- Ранний доступ: пока период не истёк, главу видят только подписчики
  -- (на автора ИЛИ на лидера команды) или купившие штучно.
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

  -- Обычная логика для платных глав
  IF NOT v_is_paid THEN RETURN true; END IF;

  -- Подписка на translator_id ИЛИ на лидера команды одинаково открывает
  -- любую главу новеллы. IN (...) корректно фильтрует NULL'ы Postgres'ом.
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

GRANT EXECUTE ON FUNCTION public.can_read_chapter_chaptify(uuid, bigint, int) TO authenticated, anon;
