-- ============================================================
-- 030: RPC для лайка коммента (фикс после миграции 029).
--
-- После 029 мы включили RLS на comments. Теперь обычный пользователь
-- НЕ может UPDATE like_count на чужих комментах (comments_self_update
-- требует auth.uid() = user_id). Клиент в CommentsSection.toggleLike()
-- именно это и делал — значит лайки сломались.
--
-- Лечим: выводим лайк в security-definer RPC, который:
--  1) Проверяет auth.uid()
--  2) Вставляет/удаляет запись в comment_likes
--  3) Пересчитывает like_count как COUNT(*) из comment_likes
--  4) Возвращает новое состояние {liked, count}
-- Клиент не делает прямых UPDATE на comments.
-- ============================================================

CREATE OR REPLACE FUNCTION public.toggle_comment_like(p_comment_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_liked boolean;
  v_count int;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  -- Проверяем существование коммента и что он не удалён
  IF NOT EXISTS (
    SELECT 1 FROM public.comments
    WHERE id = p_comment_id AND deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  -- Toggle
  IF EXISTS (
    SELECT 1 FROM public.comment_likes
    WHERE user_id = v_user AND comment_id = p_comment_id
  ) THEN
    DELETE FROM public.comment_likes
    WHERE user_id = v_user AND comment_id = p_comment_id;
    v_liked := false;
  ELSE
    INSERT INTO public.comment_likes (user_id, comment_id)
    VALUES (v_user, p_comment_id)
    ON CONFLICT DO NOTHING;
    v_liked := true;
  END IF;

  -- Пересчёт like_count через COUNT (точно, не инкременты)
  SELECT COUNT(*)::int INTO v_count
  FROM public.comment_likes
  WHERE comment_id = p_comment_id;

  UPDATE public.comments
  SET like_count = v_count
  WHERE id = p_comment_id;

  RETURN jsonb_build_object(
    'ok',     true,
    'liked',  v_liked,
    'count',  v_count
  );
END $$;

GRANT EXECUTE ON FUNCTION public.toggle_comment_like(bigint) TO authenticated;
