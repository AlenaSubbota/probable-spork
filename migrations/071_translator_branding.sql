-- ============================================================
-- 071: брендинг переводчика — палитра + печать-марка
--
-- Идея: каждый переводчик собирает свой «герб» из ограниченного
-- набора — палитра (цветовая тема, накатываемая на читалку и
-- профиль) + seal (SVG-печать, которая ставится подписью под
-- главой и мелким маркером в углу обложек его новелл).
--
-- Зачем не свободные значения: чтобы а) гарантировать контраст
-- (палитры предтестированы под читаемость и тёмную тему); б)
-- сайт сохранил единство стиля; в) миграции/CSS могли держать
-- whitelisted set без боязни мусорных значений из БД.
--
-- Палитры (6): amber, midnight, sage, rose, ink, paper.
-- Печати (8): crescent, star, feather, leaf, flame, wave, compass, key.
-- NULL значит «без брендинга» — переводчик ещё не выбирал, рендерим
-- как раньше.
--
-- Tene не трогаем: его SPA не знает про эти поля.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS translator_brand_palette text,
  ADD COLUMN IF NOT EXISTS translator_brand_seal    text;

-- Whitelist значений. Пустую строку приравниваем к NULL — иначе
-- клиент, отправивший '' из формы, повалит CHECK.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS translator_brand_palette_check;
ALTER TABLE public.profiles
  ADD  CONSTRAINT translator_brand_palette_check
  CHECK (
    translator_brand_palette IS NULL
    OR translator_brand_palette IN
       ('amber','midnight','sage','rose','ink','paper')
  );

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS translator_brand_seal_check;
ALTER TABLE public.profiles
  ADD  CONSTRAINT translator_brand_seal_check
  CHECK (
    translator_brand_seal IS NULL
    OR translator_brand_seal IN
       ('crescent','star','feather','leaf','flame','wave','compass','key')
  );

-- Расширяем public_profiles (мигр. 040): новые поля должны быть
-- видны анонимам — иначе нельзя применить брендинг переводчика
-- незалогиненному читателю на /t/[slug] и в читалке.
DROP VIEW IF EXISTS public.public_profiles;
CREATE VIEW public.public_profiles AS
SELECT
  p.id,
  p.user_name,
  p.translator_slug,
  p.translator_display_name,
  p.translator_avatar_url,
  p.avatar_url,
  p.translator_about,
  p.payout_boosty_url,
  p.payout_tribute_channel,
  p.quiet_until,
  p.quiet_note,
  p.role,
  p.is_admin,
  p.translator_brand_palette,
  p.translator_brand_seal,
  COALESCE(
    (p.settings::jsonb)->>'show_reading_publicly',
    'true'
  )::boolean AS show_reading_publicly,
  CASE
    WHEN COALESCE((p.settings::jsonb)->>'show_reading_publicly', 'true')::boolean
      THEN p.last_read
    ELSE NULL
  END AS last_read,
  CASE
    WHEN COALESCE((p.settings::jsonb)->>'show_reading_publicly', 'true')::boolean
      THEN p.bookmarks
    ELSE NULL
  END AS bookmarks
FROM public.profiles p;

ALTER VIEW public.public_profiles OWNER TO supabase_admin;
GRANT SELECT ON public.public_profiles TO anon, authenticated;

-- Расширяем update_my_settings (мигр. 037): пусть умеет обновлять
-- бренд. Пустая строка → NULL (переводчик «снял брендинг»). Любые
-- другие невалидные значения отвергнет CHECK выше.
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
                               END,
    accepts_coins_for_chapters = CASE
                                   WHEN data_to_update ? 'accepts_coins_for_chapters'
                                     THEN (data_to_update->>'accepts_coins_for_chapters')::boolean
                                   ELSE accepts_coins_for_chapters
                                 END,
    translator_brand_palette = CASE
                                 WHEN data_to_update ? 'translator_brand_palette'
                                   THEN NULLIF(data_to_update->>'translator_brand_palette', '')
                                 ELSE translator_brand_palette
                               END,
    translator_brand_seal    = CASE
                                 WHEN data_to_update ? 'translator_brand_seal'
                                   THEN NULLIF(data_to_update->>'translator_brand_seal', '')
                                 ELSE translator_brand_seal
                               END
  WHERE id = auth.uid();
END $$;
