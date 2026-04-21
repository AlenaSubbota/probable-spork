-- ============================================================
-- 018: цена главы в БД + защищённая покупка + RLS на chapter_purchases
-- - chapters.price_coins — переводчик задаёт цену в ChapterForm
-- - buy_chapter больше не принимает p_price: сервер сам читает актуальную
--   цену из chapters и переводчика из novels (клиент не может подсунуть своё)
-- - RLS на chapter_purchases: читатель видит только свои покупки,
--   переводчик — свои новеллы, админ — всё
-- Безопасно для tene: добавление колонки с дефолтом + пересоздание RPC.
-- ============================================================

ALTER TABLE public.chapters
  ADD COLUMN IF NOT EXISTS price_coins int NOT NULL DEFAULT 10;

-- Держим цену и в черновиках — чтобы автосейв не терял её
ALTER TABLE public.chapter_drafts
  ADD COLUMN IF NOT EXISTS price_coins int DEFAULT 10;

-- Ценник имеет смысл только для платных глав, но колонка живёт у всех,
-- чтобы переводчик мог в любой момент переключить is_paid.
ALTER TABLE public.chapters
  DROP CONSTRAINT IF EXISTS chapters_price_coins_check;
ALTER TABLE public.chapters
  ADD CONSTRAINT chapters_price_coins_check
  CHECK (price_coins BETWEEN 1 AND 500);

-- ---- RPC: покупка главы -------------------------------------
-- Переписываем без p_price. Старая подпись остаётся для совместимости
-- с клиентами, но тоже игнорирует переданную цену.

DROP FUNCTION IF EXISTS public.buy_chapter(uuid, bigint, int, int);

CREATE OR REPLACE FUNCTION public.buy_chapter(
  p_novel   bigint,
  p_chapter int
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user       uuid := auth.uid();
  v_balance    int;
  v_price      int;
  v_is_paid    boolean;
  v_translator uuid;
  v_already    boolean;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  -- Берём цену из главы + переводчика из новеллы. Клиент ничего не присылает.
  SELECT c.price_coins, c.is_paid, n.translator_id
  INTO   v_price, v_is_paid, v_translator
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

  -- Уже купил → идемпотентно возвращаем ok + нулевое списание
  SELECT EXISTS (
    SELECT 1 FROM public.chapter_purchases
    WHERE user_id = v_user AND novel_id = p_novel AND chapter_number = p_chapter
  ) INTO v_already;

  IF v_already THEN
    RETURN jsonb_build_object('ok', true, 'already_owned', true, 'price', v_price);
  END IF;

  -- Лочим строку баланса — одновременные покупки не списывают дважды
  SELECT coin_balance INTO v_balance
  FROM public.profiles WHERE id = v_user FOR UPDATE;

  IF v_balance IS NULL OR v_balance < v_price THEN
    RETURN jsonb_build_object(
      'ok',      false,
      'error',   'insufficient_balance',
      'price',   v_price,
      'balance', COALESCE(v_balance, 0)
    );
  END IF;

  UPDATE public.profiles
  SET    coin_balance = coin_balance - v_price
  WHERE  id = v_user;

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
    'ok',      true,
    'price',   v_price,
    'balance', v_balance - v_price
  );
END $$;

GRANT EXECUTE ON FUNCTION public.buy_chapter(bigint, int) TO authenticated;

-- ---- RLS на chapter_purchases ------------------------------
ALTER TABLE public.chapter_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchases_self_read       ON public.chapter_purchases;
DROP POLICY IF EXISTS purchases_translator_read ON public.chapter_purchases;
DROP POLICY IF EXISTS purchases_admin_all       ON public.chapter_purchases;

-- Читатель видит свои покупки
CREATE POLICY purchases_self_read
  ON public.chapter_purchases FOR SELECT
  USING (auth.uid() = user_id);

-- Переводчик видит покупки своих новелл (для аналитики)
CREATE POLICY purchases_translator_read
  ON public.chapter_purchases FOR SELECT
  USING (auth.uid() = translator_id);

-- Админ видит всё
CREATE POLICY purchases_admin_all
  ON public.chapter_purchases FOR ALL
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

-- INSERT только через buy_chapter (SECURITY DEFINER), напрямую запрещаем:
REVOKE INSERT, UPDATE, DELETE ON public.chapter_purchases FROM authenticated;
GRANT  SELECT                 ON public.chapter_purchases TO authenticated;

-- ---- RPC: какие главы куплены в этой новелле ----------------
-- Используется на странице новеллы, чтобы подсветить купленные.

CREATE OR REPLACE FUNCTION public.my_purchased_chapters(p_novel bigint)
RETURNS int[]
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(array_agg(chapter_number ORDER BY chapter_number), ARRAY[]::int[])
  FROM public.chapter_purchases
  WHERE user_id = auth.uid() AND novel_id = p_novel;
$$;

GRANT EXECUTE ON FUNCTION public.my_purchased_chapters(bigint) TO authenticated;
