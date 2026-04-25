-- ============================================================
-- 058: команда автоматически забирает все новеллы своего лидера
--
-- Раньше после create_my_team свежесозданная команда оставалась
-- «пустой» — у новелл лидера translator_id указывал на него, но
-- team_id оставался NULL. На карточках новелл читатели по-прежнему
-- видели одиночного переводчика. Алёна заметила: «я создала команду
-- tenebris, а в новеллах всё ещё мой профиль, не команды».
--
-- Чиним:
--   1. create_my_team теперь после INSERT'а команды и записи lead-а
--      делает UPDATE novels SET team_id = ... WHERE translator_id =
--      auth.uid() AND team_id IS NULL. Если у новеллы уже есть другая
--      команда — не трогаем (сознательный выбор автора).
--   2. Новый RPC attach_my_novels_to_team(team_id) — для случая, когда
--      команда уже создана давно, а новеллы потом дописались. Кнопка
--      на /admin/team/[id]/edit.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_my_team(
  p_slug        text,
  p_name        text,
  p_description text DEFAULT NULL,
  p_avatar_url  text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_team_id   bigint;
  v_attached  int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  INSERT INTO public.translator_teams (slug, name, description, avatar_url, owner_id)
  VALUES (p_slug, p_name, NULLIF(btrim(p_description), ''), p_avatar_url, v_uid)
  RETURNING id INTO v_team_id;

  INSERT INTO public.team_members (team_id, user_id, role, share_percent, sort_order)
  VALUES (v_team_id, v_uid, 'lead', 100, 0);

  -- Auto-attach: все мои новеллы без команды теперь принадлежат этой.
  -- Если автор позже захочет вывести что-то из команды — открепит вручную
  -- через TeamNovelsLinker.
  UPDATE public.novels
  SET team_id = v_team_id
  WHERE translator_id = v_uid AND team_id IS NULL;
  GET DIAGNOSTICS v_attached = ROW_COUNT;

  -- Возвращаем id команды; кол-во прицеплённых видно в логах,
  -- фронт его при необходимости считает сам.
  RETURN v_team_id;
END $$;

GRANT EXECUTE ON FUNCTION public.create_my_team(text, text, text, text) TO authenticated;

-- ============================================================
-- attach_my_novels_to_team: прицепить все новеллы юзера к его команде
-- одной кнопкой. Используем для уже созданных команд, у которых остались
-- неприцепленные новеллы (например, команда создана раньше миграции 058).
-- Возвращает количество прицепленных.
-- ============================================================
CREATE OR REPLACE FUNCTION public.attach_my_novels_to_team(p_team_id bigint)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_owner_id  uuid;
  v_attached  int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT owner_id INTO v_owner_id FROM public.translator_teams WHERE id = p_team_id;
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'team not found';
  END IF;
  IF v_owner_id <> v_uid THEN
    RAISE EXCEPTION 'only team owner can attach novels';
  END IF;

  UPDATE public.novels
  SET team_id = p_team_id
  WHERE translator_id = v_uid AND team_id IS NULL;
  GET DIAGNOSTICS v_attached = ROW_COUNT;

  RETURN v_attached;
END $$;

GRANT EXECUTE ON FUNCTION public.attach_my_novels_to_team(bigint) TO authenticated;
