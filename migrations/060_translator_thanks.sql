-- ============================================================
-- 060: «Стена благодарностей» — личные сообщения переводчику
--
-- Отдельный канал от ChapterThanks ♥ (бесплатный клик-эмоция,
-- мигр. 048). Здесь читатель пишет короткое сообщение от руки —
-- «спасибо за главу 42, ревела весь вечер». Может быть привязано к
-- конкретной главе или просто «переводчику в целом».
--
-- Деньги Chaptify не трогает (как и обещали). Сообщение чисто
-- эмоциональное: для переводчика — топливо против выгорания, для
-- читателя — способ выразить, для остальных — «стена» как соц-доказ.
--
-- Tene не трогаем — таблица новая.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.translator_thanks (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reader_id       uuid   NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  translator_id   uuid   NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  novel_id        bigint REFERENCES public.novels(id) ON DELETE SET NULL,
  chapter_number  int,
  message         text   NOT NULL CHECK (length(btrim(message)) BETWEEN 3 AND 500),
  -- Публичная стена — переводчик может скрывать отдельные сообщения
  -- (вдруг читатель что-то лишнее написал). По умолчанию публично.
  is_public       boolean NOT NULL DEFAULT true,
  -- Признак «прочитано» — чтобы переводчик видел только новые на
  -- дашборде. Меняет сам переводчик (UPDATE через RLS).
  is_read         boolean NOT NULL DEFAULT false,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (reader_id <> translator_id)
);

CREATE INDEX IF NOT EXISTS idx_thanks_translator
  ON public.translator_thanks (translator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_thanks_reader
  ON public.translator_thanks (reader_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_thanks_translator_unread
  ON public.translator_thanks (translator_id) WHERE NOT is_read;

ALTER TABLE public.translator_thanks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tt_read_public        ON public.translator_thanks;
DROP POLICY IF EXISTS tt_read_translator    ON public.translator_thanks;
DROP POLICY IF EXISTS tt_read_reader        ON public.translator_thanks;
DROP POLICY IF EXISTS tt_insert_reader      ON public.translator_thanks;
DROP POLICY IF EXISTS tt_update_translator  ON public.translator_thanks;
DROP POLICY IF EXISTS tt_delete_reader      ON public.translator_thanks;
DROP POLICY IF EXISTS tt_admin_all          ON public.translator_thanks;

-- Публичные сообщения видят все (для стены на /t/[slug])
CREATE POLICY tt_read_public
  ON public.translator_thanks FOR SELECT
  USING (is_public = true);

-- Переводчик видит ВСЕ свои сообщения (включая скрытые им же)
CREATE POLICY tt_read_translator
  ON public.translator_thanks FOR SELECT
  USING (auth.uid() = translator_id);

-- Автор сообщения видит свои (даже если переводчик скрыл — пусть знает,
-- что он написал)
CREATE POLICY tt_read_reader
  ON public.translator_thanks FOR SELECT
  USING (auth.uid() = reader_id);

-- Писать может только сам читатель и только себе как reader_id
CREATE POLICY tt_insert_reader
  ON public.translator_thanks FOR INSERT
  WITH CHECK (auth.uid() = reader_id AND auth.uid() <> translator_id);

-- Переводчик может пометить «прочитано» / скрыть из публичной стены
CREATE POLICY tt_update_translator
  ON public.translator_thanks FOR UPDATE
  USING (auth.uid() = translator_id)
  WITH CHECK (auth.uid() = translator_id);

-- Удалить может только сам автор (передумал писать)
CREATE POLICY tt_delete_reader
  ON public.translator_thanks FOR DELETE
  USING (auth.uid() = reader_id);

CREATE POLICY tt_admin_all
  ON public.translator_thanks FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = true OR role = 'admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = true OR role = 'admin')
  ));

GRANT SELECT                        ON public.translator_thanks TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.translator_thanks TO authenticated;

-- ============================================================
-- View thanks_wall_view: публичные сообщения + автор (avatar/name)
-- + новелла (если есть). Для рендера стены и дашборда.
-- ============================================================
CREATE OR REPLACE VIEW public.thanks_wall_view AS
SELECT
  t.id,
  t.reader_id,
  t.translator_id,
  t.novel_id,
  t.chapter_number,
  t.message,
  t.is_public,
  t.is_read,
  t.read_at,
  t.created_at,
  -- Автор сообщения
  p.user_name              AS reader_user_name,
  p.translator_display_name AS reader_display_name,
  p.avatar_url             AS reader_avatar_url,
  p.translator_slug        AS reader_translator_slug,
  -- Новелла (опц.)
  n.title                  AS novel_title,
  n.firebase_id            AS novel_firebase_id
FROM public.translator_thanks t
LEFT JOIN public.profiles p ON p.id = t.reader_id
LEFT JOIN public.novels   n ON n.id = t.novel_id;

ALTER VIEW public.thanks_wall_view OWNER TO supabase_admin;
GRANT SELECT ON public.thanks_wall_view TO anon, authenticated;

-- ============================================================
-- RPC mark_my_thanks_read: пометить «прочитано» все или один.
-- Чтобы дашборд переводчика мог одной кнопкой обнулить счётчик.
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_my_thanks_read(p_id bigint DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_n   int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_id IS NULL THEN
    UPDATE public.translator_thanks
    SET is_read = true, read_at = now()
    WHERE translator_id = v_uid AND is_read = false;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  ELSE
    UPDATE public.translator_thanks
    SET is_read = true, read_at = now()
    WHERE id = p_id AND translator_id = v_uid AND is_read = false;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;

  RETURN v_n;
END $$;

GRANT EXECUTE ON FUNCTION public.mark_my_thanks_read(bigint) TO authenticated;
