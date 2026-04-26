-- ============================================================
-- 061: чистим profiles.translator_slug от unicode-мусора
--
-- Проблема: до сих пор не было валидации формата slug'а, и читатели
-- получали URL'ы вида /t/Alena%20%E1%A5%AB%E1%AD%A1 (когда в slug
-- лежало «Alena ᥫ᭡»). На странице переводчика они работают через
-- редкий код-путь, но пользователь справедливо растерян: «у меня
-- два разных профиля?».
--
-- План:
--   1) helper public.slugify_translator_handle — приводит произвольную
--      строку к ascii-safe slug'у [a-z0-9-]+ длиной 2..40, либо NULL.
--   2) bulk-update: каждый translator_slug, не подходящий под формат,
--      пересохраняем санитайзером; если slug пустой — NULL; конфликты
--      разрешаем суффиксом -<6 первых символов user_id>.
--   3) CHECK constraint (NOT VALID на старые поломанные строки уже
--      не остаётся после bulk-fix, поэтому валидация безопасна).
-- ============================================================

CREATE OR REPLACE FUNCTION public.slugify_translator_handle(p_input text)
RETURNS text LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v text;
BEGIN
  IF p_input IS NULL THEN RETURN NULL; END IF;
  v := lower(p_input);
  -- Спецсимволы и нелатиница — выкидываем целиком (не транслитим:
  -- транслит русского-«Алёна» → «alyona» имеет десяток конвенций,
  -- лучше пользователь сам перевыбирает осмысленный handle).
  v := regexp_replace(v, '[^a-z0-9-]+', '', 'g');
  -- Тиры на краях — наружу, и подряд несколько тире — в один.
  v := regexp_replace(v, '-+', '-', 'g');
  v := regexp_replace(v, '^-+|-+$', '', 'g');
  IF length(v) < 2 THEN RETURN NULL; END IF;
  IF length(v) > 40 THEN v := substr(v, 1, 40); END IF;
  RETURN v;
END $$;

GRANT EXECUTE ON FUNCTION public.slugify_translator_handle(text)
  TO authenticated, anon;

-- Bulk fix: чиним всё, что не проходит формат.
DO $$
DECLARE
  r       RECORD;
  v_clean text;
  v_try   text;
  v_n     int;
BEGIN
  FOR r IN
    SELECT id, translator_slug
    FROM public.profiles
    WHERE translator_slug IS NOT NULL
      AND translator_slug !~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'
  LOOP
    v_clean := public.slugify_translator_handle(r.translator_slug);
    IF v_clean IS NULL THEN
      UPDATE public.profiles SET translator_slug = NULL WHERE id = r.id;
      CONTINUE;
    END IF;

    -- Если такой slug уже занят (после санитайза могли совпасть
    -- разные «alena» из разных кириллических вариантов) — добавляем
    -- хвост из user_id.
    v_try := v_clean;
    SELECT count(*) INTO v_n
    FROM public.profiles
    WHERE translator_slug = v_try AND id <> r.id;
    IF v_n > 0 THEN
      v_try := v_clean || '-' || substr(r.id::text, 1, 6);
    END IF;

    UPDATE public.profiles SET translator_slug = v_try WHERE id = r.id;
  END LOOP;
END $$;

-- Constraint на формат. Минимальная длина 2 (для односимвольных
-- handle'ов нет смысла, читатель не отличит /t/a от /t/b в URL'ах).
-- Максимум 40 — длина типичного twitter-handle'а с запасом.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_translator_slug_format;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_translator_slug_format
  CHECK (
    translator_slug IS NULL
    OR translator_slug ~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$'
  );

-- ============================================================
-- update_my_settings (мигр. 037) принимает translator_slug сейчас?
-- Проверим — да, через объединённый settings jsonb. Если придёт
-- кривое значение, BD теперь его отвергнет CHECK'ом — фронт получит
-- ошибку и покажет toast. До этого пролезало молча.
-- ============================================================
