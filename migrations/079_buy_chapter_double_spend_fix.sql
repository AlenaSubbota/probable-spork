-- ============================================================
-- 079: фикс double-spend в buy_chapter
--
-- Сценарий из аудита:
--   баланс=200, цена=100, юзер шлёт два параллельных RPC.
--
--   T1: SELECT EXISTS chapter_purchases → false
--   T2: SELECT EXISTS chapter_purchases → false   (оба прошли проверку)
--   T1: SELECT FOR UPDATE coins (balance=200), lock acquired
--   T2: блокируется на той же строке
--   T1: UPDATE coins balance=100, INSERT chapter_purchases, COMMIT
--   T2: разблокировался → SELECT FOR UPDATE coins видит balance=100,
--       passes >= price=100 → UPDATE balance=0,
--       INSERT chapter_purchases → ON CONFLICT DO NOTHING (skip),
--       но 100 монет уже списано второй раз за уже купленную главу.
--
-- Фикс: проверку chapter_purchases EXISTS делаем дважды:
--   - первый раз ДО лока (фаст-путь идемпотентного ответа)
--   - второй раз ПОСЛЕ FOR UPDATE на coins (то самый момент гонки;
--     внутри лока никто другой не может вставить purchase для этой
--     пары user/translator, потому что вторая INSERT-попытка тоже
--     серилизована через тот же coin-row).
--
-- Альтернатива — INSERT chapter_purchases ... RETURNING до списания и
-- откат если 0 строк, но такая структура потребует ROLLBACK логики,
-- а PG функция в plpgsql на одно RETURN ... жёстко не разорвётся.
-- Двойная проверка проще и однозначно корректна.
-- ============================================================

CREATE OR REPLACE FUNCTION public.buy_chapter(
  p_novel   bigint,
  p_chapter int
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_balance     int;
  v_price       int;
  v_is_paid     boolean;
  v_translator  uuid;
  v_already     boolean;
  v_accepts     boolean;
  v_has_content boolean;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT
    c.price_coins,
    c.is_paid,
    n.translator_id,
    c.content_path IS NOT NULL AND length(btrim(c.content_path)) > 0
  INTO v_price, v_is_paid, v_translator, v_has_content
  FROM public.chapters c
  JOIN public.novels   n ON n.id = c.novel_id
  WHERE c.novel_id = p_novel AND c.chapter_number = p_chapter
  LIMIT 1;

  IF v_price IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'chapter_not_found');
  END IF;
  IF NOT v_is_paid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'chapter_is_free');
  END IF;
  IF v_translator IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'external_translator');
  END IF;
  IF NOT v_has_content THEN
    RETURN jsonb_build_object('ok', false, 'error', 'chapter_no_content');
  END IF;

  SELECT COALESCE(accepts_coins_for_chapters, true)
  INTO v_accepts
  FROM public.profiles
  WHERE id = v_translator;
  IF NOT COALESCE(v_accepts, true) THEN
    RETURN jsonb_build_object(
      'ok',            false,
      'error',         'translator_coins_disabled',
      'translator_id', v_translator
    );
  END IF;

  -- Фаст-путь: уже куплено → идемпотентно возвращаем ok без лока.
  SELECT EXISTS (
    SELECT 1 FROM public.chapter_purchases
    WHERE user_id = v_user AND novel_id = p_novel AND chapter_number = p_chapter
  ) INTO v_already;

  IF v_already THEN
    RETURN jsonb_build_object('ok', true, 'already_owned', true, 'price', v_price);
  END IF;

  -- Берём/лочим per-translator баланс. Все параллельные buy_chapter для
  -- этой пары (user, translator) серилизуются здесь.
  SELECT balance INTO v_balance
  FROM public.reader_translator_coins
  WHERE user_id = v_user AND translator_id = v_translator
  FOR UPDATE;

  -- Re-check ВНУТРИ лока: пока мы ждали, другая транзакция могла уже
  -- вставить purchase и списать. Без этой проверки выходит double-spend
  -- ровно на одну параллельную покупку (см. шапку миграции).
  SELECT EXISTS (
    SELECT 1 FROM public.chapter_purchases
    WHERE user_id = v_user AND novel_id = p_novel AND chapter_number = p_chapter
  ) INTO v_already;

  IF v_already THEN
    RETURN jsonb_build_object('ok', true, 'already_owned', true, 'price', v_price);
  END IF;

  IF v_balance IS NULL OR v_balance < v_price THEN
    RETURN jsonb_build_object(
      'ok',            false,
      'error',         'insufficient_balance',
      'price',         v_price,
      'balance',       COALESCE(v_balance, 0),
      'translator_id', v_translator
    );
  END IF;

  -- Списываем у читателя
  UPDATE public.reader_translator_coins
  SET    balance    = balance - v_price,
         updated_at = now()
  WHERE  user_id = v_user AND translator_id = v_translator;

  INSERT INTO public.coin_transactions
    (user_id, amount, reason, reference_type, reference_id)
  VALUES
    (v_user, -v_price, 'chapter_purchase', 'chapter',
     p_novel::text || ':' || p_chapter::text);

  -- ON CONFLICT DO NOTHING оставляем как defense-in-depth, но после
  -- двойной проверки выше реальный конфликт здесь невозможен.
  INSERT INTO public.chapter_purchases
    (user_id, novel_id, chapter_number, translator_id, price_coins)
  VALUES
    (v_user, p_novel, p_chapter, v_translator, v_price)
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'ok',            true,
    'price',         v_price,
    'balance',       v_balance - v_price,
    'translator_id', v_translator
  );
END $$;

GRANT EXECUTE ON FUNCTION public.buy_chapter(bigint, int) TO authenticated;
