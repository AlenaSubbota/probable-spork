-- ============================================================
-- 025: лайки и чаевые переводчику
-- - chapter_thanks: читатель «спасибо» нажал под главой. Можно
--   присоединить денежный tip (coin amount). Одна запись на пару
--   (user, novel, chapter).
-- - RPC thank_chapter(novel, chapter, tip_coins): атомарно списывает
--   монеты с читателя, зачисляет переводчику (как coin_transactions
--   + chapter_thanks).
-- - Триггер уведомления переводчику о благодарности.
-- Безопасно для tene: только новая таблица + RPC.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.chapter_thanks (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        uuid   NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  novel_id       bigint NOT NULL REFERENCES public.novels(id) ON DELETE CASCADE,
  chapter_number int    NOT NULL,
  translator_id  uuid   REFERENCES public.profiles(id) ON DELETE SET NULL,
  tip_coins      int    NOT NULL DEFAULT 0 CHECK (tip_coins >= 0 AND tip_coins <= 500),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, novel_id, chapter_number)
);

CREATE INDEX IF NOT EXISTS idx_thanks_novel_chapter
  ON public.chapter_thanks (novel_id, chapter_number);

CREATE INDEX IF NOT EXISTS idx_thanks_translator
  ON public.chapter_thanks (translator_id, created_at DESC);

ALTER TABLE public.chapter_thanks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS thanks_self_read       ON public.chapter_thanks;
DROP POLICY IF EXISTS thanks_translator_read ON public.chapter_thanks;
DROP POLICY IF EXISTS thanks_admin_all       ON public.chapter_thanks;
DROP POLICY IF EXISTS thanks_public_counts   ON public.chapter_thanks;

-- Читатель видит свои «спасибо»
CREATE POLICY thanks_self_read
  ON public.chapter_thanks FOR SELECT
  USING (auth.uid() = user_id);

-- Переводчик видит свои чаевые (имя жертвователя отображается в UI)
CREATE POLICY thanks_translator_read
  ON public.chapter_thanks FOR SELECT
  USING (auth.uid() = translator_id);

-- Админ видит всё
CREATE POLICY thanks_admin_all
  ON public.chapter_thanks FOR ALL
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

-- Счётчик лайков виден всем (чтобы рендерить «N спасибо» под главой)
-- НО данные о user_id при этом не утекают — политика на SELECT этот
-- ряд не откроет, приходится на уровне RPC считать count() через
-- security-definer.

-- Запрещаем прямые insert через клиент (только RPC)
REVOKE INSERT, UPDATE, DELETE ON public.chapter_thanks FROM authenticated;
GRANT  SELECT ON public.chapter_thanks TO authenticated;

-- ---- RPC: «спасибо за главу» с опциональным tip ----

CREATE OR REPLACE FUNCTION public.thank_chapter(
  p_novel     bigint,
  p_chapter   int,
  p_tip_coins int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_translator  uuid;
  v_balance     int;
  v_already     boolean;
  v_tip         int := COALESCE(p_tip_coins, 0);
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF v_tip < 0 OR v_tip > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_tip');
  END IF;

  -- Берём translator_id (может быть NULL для внешнего — тогда без tip)
  SELECT translator_id INTO v_translator
  FROM public.novels WHERE id = p_novel;

  -- Нельзя давать чаевые «в пустоту» — если у новеллы нет зарегистрированного
  -- переводчика, tip-часть отбрасываем (сам факт спасибо засчитываем).
  IF v_translator IS NULL AND v_tip > 0 THEN
    v_tip := 0;
  END IF;

  -- Нельзя «благодарить самого себя» денежно
  IF v_user = v_translator AND v_tip > 0 THEN
    v_tip := 0;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.chapter_thanks
    WHERE user_id = v_user AND novel_id = p_novel AND chapter_number = p_chapter
  ) INTO v_already;

  -- Если уже благодарил — идемпотентно: не инсертим дважды, не списываем.
  IF v_already AND v_tip = 0 THEN
    RETURN jsonb_build_object('ok', true, 'already_thanked', true);
  END IF;

  -- Проверка баланса если есть tip
  IF v_tip > 0 THEN
    SELECT coin_balance INTO v_balance
    FROM public.profiles WHERE id = v_user FOR UPDATE;
    IF v_balance IS NULL OR v_balance < v_tip THEN
      RETURN jsonb_build_object(
        'ok',      false,
        'error',   'insufficient_balance',
        'balance', COALESCE(v_balance, 0),
        'needed',  v_tip
      );
    END IF;

    -- Списываем у читателя
    UPDATE public.profiles
    SET coin_balance = coin_balance - v_tip
    WHERE id = v_user;

    -- Зачисляем переводчику
    UPDATE public.profiles
    SET coin_balance = coin_balance + v_tip
    WHERE id = v_translator;

    -- Транзакции (для аудита)
    INSERT INTO public.coin_transactions
      (user_id, amount, reason, reference_type, reference_id)
    VALUES
      (v_user, -v_tip, 'chapter_tip', 'chapter', p_novel::text || ':' || p_chapter::text),
      (v_translator, v_tip, 'chapter_tip', 'chapter', p_novel::text || ':' || p_chapter::text);
  END IF;

  -- Инсертим запись благодарности (или апдейтим tip если повторяем)
  INSERT INTO public.chapter_thanks
    (user_id, novel_id, chapter_number, translator_id, tip_coins)
  VALUES
    (v_user, p_novel, p_chapter, v_translator, v_tip)
  ON CONFLICT (user_id, novel_id, chapter_number)
  DO UPDATE SET tip_coins = public.chapter_thanks.tip_coins + v_tip;

  RETURN jsonb_build_object(
    'ok',       true,
    'tip_sent', v_tip,
    'balance',  CASE WHEN v_tip > 0 THEN v_balance - v_tip ELSE NULL END
  );
END $$;

GRANT EXECUTE ON FUNCTION public.thank_chapter(bigint, int, int) TO authenticated;

-- ---- RPC: сводка для UI (количество лайков + получил ли текущий юзер) ----

CREATE OR REPLACE FUNCTION public.chapter_thanks_summary(
  p_novel   bigint,
  p_chapter int
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT jsonb_build_object(
    'total_count', (
      SELECT COUNT(*)::int FROM public.chapter_thanks
      WHERE novel_id = p_novel AND chapter_number = p_chapter
    ),
    'total_coins', (
      SELECT COALESCE(SUM(tip_coins), 0)::int FROM public.chapter_thanks
      WHERE novel_id = p_novel AND chapter_number = p_chapter
    ),
    'my_thanked', (
      SELECT EXISTS (
        SELECT 1 FROM public.chapter_thanks
        WHERE novel_id = p_novel AND chapter_number = p_chapter
          AND user_id = auth.uid()
      )
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.chapter_thanks_summary(bigint, int) TO authenticated, anon;

-- ---- Триггер уведомления переводчику о чаевых ----

CREATE OR REPLACE FUNCTION public.trg_notify_chapter_tip()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_from_name text;
  v_title     text;
  v_firebase  text;
BEGIN
  -- Уведомление — только если есть translator_id И есть денежная часть
  -- (чистые лайки не шлют уведомление, чтобы не заспамить).
  IF NEW.translator_id IS NULL OR NEW.tip_coins = 0 THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id = NEW.translator_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(user_name, 'Читатель')
  INTO v_from_name
  FROM public.profiles WHERE id = NEW.user_id;

  SELECT title, firebase_id INTO v_title, v_firebase
  FROM public.novels WHERE id = NEW.novel_id;

  INSERT INTO public.notifications
    (user_id, type, text, target_url, actor_id, group_key, ref_novel_id)
  VALUES
    (NEW.translator_id,
     'chapter_tip',
     v_from_name || ' поблагодарил_а за главу ' || NEW.chapter_number
       || ' новеллы «' || COALESCE(v_title, '?') || '» — +'
       || NEW.tip_coins || ' монет',
     '/novel/' || COALESCE(v_firebase, '') || '/' || NEW.chapter_number,
     NEW.user_id,
     'chapter_tip:' || NEW.novel_id || ':' || NEW.chapter_number,
     NEW.novel_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_chapter_tip ON public.chapter_thanks;
CREATE TRIGGER on_chapter_tip
  AFTER INSERT OR UPDATE OF tip_coins ON public.chapter_thanks
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_chapter_tip();
