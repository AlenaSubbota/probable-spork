-- ==========================================================================
-- 086_novel_rating_rpc
--
-- RPC `set_my_novel_rating(p_novel_id, p_rating)` для проставления/сброса
-- 5-звёздного рейтинга текущим юзером.
--
-- Таблица `novel_ratings` живёт в tene-наследии, RLS-политики и триггер
-- пересчёта `novel_stats.average_rating`/`rating_count` уже подключены
-- общим Supabase-проектом — поэтому здесь мы только пишем чистую обёртку
-- через SECURITY DEFINER, чтобы:
--   1. валидировать диапазон 1..5 на сервере (а не верить клиенту);
--   2. дать одну точку для UI: rating=NULL/0 → удалить мою оценку;
--   3. не допускать прямого RAW UPDATE из браузера (даже если RLS
--      разрешит, мы могли бы случайно перезаписать чужую строку).
--
-- Идемпотентно: можно крутить миграцию повторно.
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.set_my_novel_rating(
  p_novel_id bigint,
  p_rating   integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'auth_required');
  END IF;

  IF p_novel_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_novel_id');
  END IF;

  -- 0/NULL — пользователь хочет снять свою оценку.
  IF p_rating IS NULL OR p_rating = 0 THEN
    DELETE FROM public.novel_ratings
     WHERE novel_id = p_novel_id
       AND user_id  = v_user;
    RETURN jsonb_build_object('ok', true, 'rating', NULL);
  END IF;

  IF p_rating < 1 OR p_rating > 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rating_out_of_range');
  END IF;

  INSERT INTO public.novel_ratings AS nr (novel_id, user_id, rating)
  VALUES (p_novel_id, v_user, p_rating)
  ON CONFLICT (novel_id, user_id)
  DO UPDATE SET
    rating = EXCLUDED.rating,
    -- если в схеме есть updated_at — апдейтнем; если нет — IGNORE через SET WHERE
    updated_at = COALESCE(
      (SELECT now() WHERE EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name   = 'novel_ratings'
           AND column_name  = 'updated_at'
      )),
      nr.updated_at
    );

  RETURN jsonb_build_object('ok', true, 'rating', p_rating);
EXCEPTION
  WHEN undefined_column THEN
    -- updated_at нет в schema — пробуем без него.
    INSERT INTO public.novel_ratings (novel_id, user_id, rating)
    VALUES (p_novel_id, v_user, p_rating)
    ON CONFLICT (novel_id, user_id)
    DO UPDATE SET rating = EXCLUDED.rating;
    RETURN jsonb_build_object('ok', true, 'rating', p_rating);
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_novel_rating(bigint, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.set_my_novel_rating(bigint, integer) TO authenticated;

COMMENT ON FUNCTION public.set_my_novel_rating(bigint, integer) IS
  'Поставить/обновить/снять (rating=0 или NULL) свою оценку 1..5 на новеллу. SECURITY DEFINER — обёртка над novel_ratings.';
