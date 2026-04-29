-- ============================================================
-- 069: дополнительные guard'ы в buy_chapter
--
-- Два сценария, которые до сих пор пропускались:
--
--   1) Переводчик отключил приём монет за главы (toggle
--      `accepts_coins_for_chapters = false` в /profile/settings),
--      но у читателя на открытой странице кнопка «Купить за N
--      монет» ещё видна. Тык → списание баланса проходит,
--      хотя по новой логике покупки уже нельзя. UI прячет кнопку,
--      но это только UI; RPC никакой проверки не делает.
--
--   2) Глава физически удалена из storage (admin удалил файл,
--      но запись в `chapters` осталась с непустым `content_path`).
--      В UI читатель видит paywall, тыкает «Купить» — RPC списывает
--      монеты и записывает покупку, но контента всё равно нет.
--      Чисто content_path не покрывает все варианты (storage может
--      рассинхрониться с БД), но базовый «content_path IS NOT NULL»
--      проверим — это покрывает легитимный «нет файла» случай,
--      когда переводчик ещё не загрузил.
--
-- Меняем функцию public.buy_chapter (последняя версия — мигр. 045).
-- Сигнатура и возвращаемый jsonb-формат прежние, добавлены два
-- новых error-кода: 'translator_coins_disabled' и 'chapter_no_content'.
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
    -- B2/H4: у главы нет файла в storage. Не тратим монеты на пустоту.
    RETURN jsonb_build_object('ok', false, 'error', 'chapter_no_content');
  END IF;

  -- B2: проверяем тумблер «принимаю монеты» у переводчика. UI прячет
  -- кнопку, но если страница открыта давно или клик прилетел гонкой —
  -- здесь тоже дополнительная защита.
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

  -- Уже куплено → идемпотентно возвращаем ok без списания.
  SELECT EXISTS (
    SELECT 1 FROM public.chapter_purchases
    WHERE user_id = v_user AND novel_id = p_novel AND chapter_number = p_chapter
  ) INTO v_already;

  IF v_already THEN
    RETURN jsonb_build_object('ok', true, 'already_owned', true, 'price', v_price);
  END IF;

  -- Берём/лочим per-translator баланс
  SELECT balance INTO v_balance
  FROM public.reader_translator_coins
  WHERE user_id = v_user AND translator_id = v_translator
  FOR UPDATE;

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

  -- Audit
  INSERT INTO public.coin_transactions
    (user_id, amount, reason, reference_type, reference_id)
  VALUES
    (v_user, -v_price, 'chapter_purchase', 'chapter',
     p_novel::text || ':' || p_chapter::text);

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
