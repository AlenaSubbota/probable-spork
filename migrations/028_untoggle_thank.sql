-- ============================================================
-- 028: отмена «спасибо» за главу (toggle-off).
--
-- В миграции 025 thank_chapter() только INSERT'ит запись в
-- chapter_thanks. Если читатель нажал лайк и передумал — вернуть
-- обратно нельзя, кнопка «✓ Уже поблагодарил(а)» замирает.
--
-- Лечим: добавляем RPC untoggle_thank(), который удаляет запись,
-- НО ТОЛЬКО если это был чистый лайк (tip_coins = 0). Платные чаевые
-- уже списаны/зачислены, их отменить нельзя — в таком случае RPC
-- возвращает ok=false, UI оставляет состояние thanked.
-- ============================================================

CREATE OR REPLACE FUNCTION public.untoggle_thank(
  p_novel   bigint,
  p_chapter int
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_tip  int;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT tip_coins INTO v_tip
  FROM public.chapter_thanks
  WHERE user_id = v_user
    AND novel_id = p_novel
    AND chapter_number = p_chapter;

  IF v_tip IS NULL THEN
    -- Ничего не благодарил — ok, просто ничего не делаем.
    RETURN jsonb_build_object('ok', true, 'removed', false);
  END IF;

  IF v_tip > 0 THEN
    -- Были чаевые — не удаляем (деньги уже переведены).
    RETURN jsonb_build_object(
      'ok',       false,
      'error',    'has_tip',
      'tip_coins', v_tip
    );
  END IF;

  DELETE FROM public.chapter_thanks
  WHERE user_id = v_user
    AND novel_id = p_novel
    AND chapter_number = p_chapter;

  RETURN jsonb_build_object('ok', true, 'removed', true);
END $$;

GRANT EXECUTE ON FUNCTION public.untoggle_thank(bigint, int) TO authenticated;
