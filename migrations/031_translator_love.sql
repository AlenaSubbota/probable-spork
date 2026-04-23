-- ============================================================
-- 031: персональные фичи для переводчиков
--   1) Чаевые с сообщением + «Стена благодарностей»
--   2) Тихий режим переводчика (восстанавливается / отпуск)
--   3) Публичный роадмап («что буду переводить»)
--
-- Всё безопасно для tene.fun: только новые колонки/таблицы, никаких
-- breaking changes.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Чаевые с сообщением
-- ------------------------------------------------------------
-- chapter_thanks уже существует (миграция 025). Добавляем text-колонку
-- для опционального сообщения от читателя. Длина <=500 — достаточно, не
-- превращается в полноценный мессенджер.
ALTER TABLE public.chapter_thanks
  ADD COLUMN IF NOT EXISTS message text,
  ADD CONSTRAINT chapter_thanks_message_len
    CHECK (message IS NULL OR length(message) <= 500);

-- Перезаписываем thank_chapter: принимает p_message text DEFAULT NULL.
-- Старая сигнатура (без p_message) работает через DEFAULT, обратная
-- совместимость сохранена.
DROP FUNCTION IF EXISTS public.thank_chapter(bigint, int, int);
CREATE OR REPLACE FUNCTION public.thank_chapter(
  p_novel     bigint,
  p_chapter   int,
  p_tip_coins int  DEFAULT 0,
  p_message   text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_translator  uuid;
  v_balance     int;
  v_already     boolean;
  v_tip         int := COALESCE(p_tip_coins, 0);
  v_msg         text := NULLIF(btrim(COALESCE(p_message, '')), '');
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF v_tip < 0 OR v_tip > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_tip');
  END IF;
  IF v_msg IS NOT NULL AND length(v_msg) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'message_too_long');
  END IF;

  SELECT translator_id INTO v_translator
  FROM public.novels WHERE id = p_novel;

  IF v_translator IS NULL AND v_tip > 0 THEN
    v_tip := 0;
  END IF;
  IF v_user = v_translator AND v_tip > 0 THEN
    v_tip := 0;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.chapter_thanks
    WHERE user_id = v_user AND novel_id = p_novel AND chapter_number = p_chapter
  ) INTO v_already;

  -- Идемпотентность: если уже благодарил и сейчас нет ни tip, ни message —
  -- ничего не делаем.
  IF v_already AND v_tip = 0 AND v_msg IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_thanked', true);
  END IF;

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
    UPDATE public.profiles
    SET coin_balance = coin_balance - v_tip
    WHERE id = v_user;
    UPDATE public.profiles
    SET coin_balance = coin_balance + v_tip
    WHERE id = v_translator;
    INSERT INTO public.coin_transactions
      (user_id, amount, reason, reference_type, reference_id)
    VALUES
      (v_user, -v_tip, 'chapter_tip', 'chapter', p_novel::text || ':' || p_chapter::text),
      (v_translator, v_tip, 'chapter_tip', 'chapter', p_novel::text || ':' || p_chapter::text);
  END IF;

  -- Инсерт/апдейт благодарности. При повторе: суммируем tip и заменяем
  -- message на более свежий (если передан) — так читатель может дописать.
  INSERT INTO public.chapter_thanks
    (user_id, novel_id, chapter_number, translator_id, tip_coins, message)
  VALUES
    (v_user, p_novel, p_chapter, v_translator, v_tip, v_msg)
  ON CONFLICT (user_id, novel_id, chapter_number)
  DO UPDATE SET
    tip_coins = public.chapter_thanks.tip_coins + v_tip,
    message   = COALESCE(EXCLUDED.message, public.chapter_thanks.message);

  RETURN jsonb_build_object(
    'ok',       true,
    'tip_sent', v_tip,
    'message_saved', v_msg IS NOT NULL,
    'balance',  CASE WHEN v_tip > 0 THEN v_balance - v_tip ELSE NULL END
  );
END $$;

GRANT EXECUTE ON FUNCTION public.thank_chapter(bigint, int, int, text) TO authenticated;

-- View «Стена благодарностей» переводчика: отдаёт сообщения публично
-- (без user_id), но только с tip_coins > 0 ИЛИ message IS NOT NULL —
-- пустые записи «лайк без текста» не выкладываем на стену.
-- Безопасно: показываем имя читателя из profiles, но не его id.
CREATE OR REPLACE VIEW public.translator_tributes_view AS
SELECT
  t.id,
  t.translator_id,
  t.novel_id,
  t.chapter_number,
  t.tip_coins,
  t.message,
  t.created_at,
  COALESCE(p.user_name, 'Читатель') AS from_name,
  p.avatar_url                       AS from_avatar,
  n.title                            AS novel_title,
  n.firebase_id                      AS novel_firebase_id
FROM public.chapter_thanks t
LEFT JOIN public.profiles p ON p.id = t.user_id
LEFT JOIN public.novels   n ON n.id = t.novel_id
WHERE t.translator_id IS NOT NULL
  AND (t.tip_coins > 0 OR t.message IS NOT NULL);

ALTER VIEW public.translator_tributes_view OWNER TO supabase_admin;
GRANT SELECT ON public.translator_tributes_view TO anon, authenticated;

-- ------------------------------------------------------------
-- 2. Тихий режим переводчика
-- ------------------------------------------------------------
-- Флаг + до какого времени восстанавливается + короткая личная пометка.
-- Когда quiet_until IS NULL или в прошлом — режим выключен.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS quiet_until timestamptz,
  ADD COLUMN IF NOT EXISTS quiet_note  text;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_quiet_note_len
    CHECK (quiet_note IS NULL OR length(quiet_note) <= 300);

-- RPC update_my_settings (из миграции 012) расширяется: теперь
-- пропускает quiet_until / quiet_note. Ключевой момент — позволяем
-- явно ОБНУЛИТЬ: если ключ есть в data_to_update и value = null,
-- пишем NULL (а не оставляем старое как делает COALESCE).
-- Для этого проверяем ? (has key), а не просто ->>.
CREATE OR REPLACE FUNCTION public.update_my_settings(data_to_update jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.profiles
  SET
    user_name                = COALESCE(data_to_update->>'user_name',                user_name),
    avatar_url               = COALESCE(data_to_update->>'avatar_url',               avatar_url),
    translator_display_name  = COALESCE(data_to_update->>'translator_display_name',  translator_display_name),
    translator_avatar_url    = COALESCE(data_to_update->>'translator_avatar_url',    translator_avatar_url),
    translator_about         = COALESCE(data_to_update->>'translator_about',         translator_about),
    payout_boosty_url        = COALESCE(data_to_update->>'payout_boosty_url',        payout_boosty_url),
    settings                 = COALESCE(data_to_update->'settings',                  settings),
    quiet_until              = CASE
                                 WHEN data_to_update ? 'quiet_until'
                                   THEN (data_to_update->>'quiet_until')::timestamptz
                                 ELSE quiet_until
                               END,
    quiet_note               = CASE
                                 WHEN data_to_update ? 'quiet_note'
                                   THEN NULLIF(btrim(data_to_update->>'quiet_note'), '')
                                 ELSE quiet_note
                               END
  WHERE id = auth.uid();
END $$;

-- ------------------------------------------------------------
-- 3. Публичный роадмап переводчика
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.translator_roadmap (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  translator_id     uuid   NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title             text   NOT NULL,
  note              text,
  status            text   NOT NULL DEFAULT 'planned'
                      CHECK (status IN ('planned', 'in_progress', 'completed', 'paused')),
  progress_current  int    DEFAULT 0 CHECK (progress_current >= 0),
  progress_total    int    DEFAULT 0 CHECK (progress_total >= 0),
  sort_order        int    NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roadmap_title_len CHECK (length(title) BETWEEN 1 AND 200),
  CONSTRAINT roadmap_note_len  CHECK (note IS NULL OR length(note) <= 500)
);

CREATE INDEX IF NOT EXISTS idx_roadmap_translator
  ON public.translator_roadmap (translator_id, sort_order);

ALTER TABLE public.translator_roadmap ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roadmap_read_all       ON public.translator_roadmap;
DROP POLICY IF EXISTS roadmap_owner_all      ON public.translator_roadmap;
DROP POLICY IF EXISTS roadmap_admin_all      ON public.translator_roadmap;

CREATE POLICY roadmap_read_all
  ON public.translator_roadmap FOR SELECT
  USING (true);

-- Переводчик правит только свои записи
CREATE POLICY roadmap_owner_all
  ON public.translator_roadmap FOR ALL
  USING (auth.uid() = translator_id)
  WITH CHECK (auth.uid() = translator_id);

-- Админ может всё
CREATE POLICY roadmap_admin_all
  ON public.translator_roadmap FOR ALL
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

GRANT SELECT                        ON public.translator_roadmap TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.translator_roadmap TO authenticated;

-- Триггер: updated_at при апдейте
CREATE OR REPLACE FUNCTION public.trg_roadmap_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS roadmap_touch ON public.translator_roadmap;
CREATE TRIGGER roadmap_touch
  BEFORE UPDATE ON public.translator_roadmap
  FOR EACH ROW EXECUTE FUNCTION public.trg_roadmap_touch();
