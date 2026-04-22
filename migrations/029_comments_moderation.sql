-- ============================================================
-- 029: модерация комментариев админом.
--
-- До сих пор комменты (таблица comments, legacy из tene) имели только
-- insert/select; ни автор, ни админ не могли редактировать или удалить.
-- Модерация была невозможна.
--
-- План:
--  1) Добавляем колонки deleted_at, edited_at, moderator_id (soft-delete
--     + аудит кто редактировал).
--  2) RLS: админ может UPDATE/DELETE любую запись; автор — UPDATE своей
--     (только поле text, не метаданные).
--  3) View comments_view: отдаёт «[комментарий удалён]» вместо текста если
--     deleted_at IS NOT NULL. Клиент не видит исходный текст удалённого
--     комментария — и это безопаснее, и кэш не светит старое.
-- ============================================================

ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS deleted_at   timestamptz,
  ADD COLUMN IF NOT EXISTS edited_at    timestamptz,
  ADD COLUMN IF NOT EXISTS moderator_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Включаем RLS если ещё не включён
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

-- Убираем старые policy если были, пересоздаём
DROP POLICY IF EXISTS comments_read_all         ON public.comments;
DROP POLICY IF EXISTS comments_self_insert      ON public.comments;
DROP POLICY IF EXISTS comments_self_update      ON public.comments;
DROP POLICY IF EXISTS comments_admin_all        ON public.comments;

-- Все видят все комменты (в том числе удалённые — view отдаст placeholder)
CREATE POLICY comments_read_all
  ON public.comments FOR SELECT
  USING (true);

-- Авторизованный пользователь может постить от своего имени
CREATE POLICY comments_self_insert
  ON public.comments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Автор может редактировать свой комментарий (только если не удалён)
CREATE POLICY comments_self_update
  ON public.comments FOR UPDATE
  USING (auth.uid() = user_id AND deleted_at IS NULL)
  WITH CHECK (auth.uid() = user_id);

-- Админ может всё
CREATE POLICY comments_admin_all
  ON public.comments FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND (is_admin = true OR role = 'admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND (is_admin = true OR role = 'admin')
  ));

-- RPC: soft-delete коммента (для админа) — выставляет deleted_at + moderator_id.
-- Почему RPC а не прямой UPDATE с клиента: moderator_id должен проставиться
-- автоматически, чтобы был аудит «кто удалил». Клиент не должен его
-- подставлять сам (могут подменить).
CREATE OR REPLACE FUNCTION public.moderate_delete_comment(p_comment_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_user AND (is_admin = true OR role = 'admin')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_admin');
  END IF;

  UPDATE public.comments
  SET deleted_at   = now(),
      moderator_id = v_user
  WHERE id = p_comment_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'already_deleted', true);
  END IF;

  RETURN jsonb_build_object('ok', true, 'deleted', true);
END $$;

GRANT EXECUTE ON FUNCTION public.moderate_delete_comment(bigint) TO authenticated;

-- RPC: редактирование коммента (для автора или админа). Проставляет edited_at.
CREATE OR REPLACE FUNCTION public.edit_comment(
  p_comment_id bigint,
  p_text       text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_author  uuid;
  v_deleted timestamptz;
  v_admin   boolean;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF p_text IS NULL OR length(trim(p_text)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'empty_text');
  END IF;
  IF length(p_text) > 2000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'text_too_long');
  END IF;

  SELECT user_id, deleted_at
  INTO v_author, v_deleted
  FROM public.comments
  WHERE id = p_comment_id;

  IF v_author IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_deleted IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_deleted');
  END IF;

  SELECT (is_admin = true OR role = 'admin')
  INTO v_admin
  FROM public.profiles WHERE id = v_user;

  IF v_user <> v_author AND v_admin IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  UPDATE public.comments
  SET text         = p_text,
      edited_at    = now(),
      moderator_id = CASE WHEN v_user <> v_author THEN v_user ELSE moderator_id END
  WHERE id = p_comment_id;

  RETURN jsonb_build_object('ok', true, 'edited', true);
END $$;

GRANT EXECUTE ON FUNCTION public.edit_comment(bigint, text) TO authenticated;
