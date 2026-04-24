-- ============================================================
-- Миграция 047: синхронизация настроек читалки и темы между устройствами
--
-- Алёна: «Нужно чтобы настройки текста и тема выбранная сохранялись на
-- всех устройствах, с которых заходит пользователь. Прогресс чтения и
-- абзац на котором остановился пользователь должны сохраняться на всех
-- устройствах и если заблокировать/разблокировать экран.»
--
-- Все три блока данных хранятся в `profiles.settings jsonb`:
--   - settings.reader  — ReaderSettings (шрифт, размер, тема читалки и т.п.)
--   - settings.theme   — глобальная тема сайта (light/dark/auto)
--   - settings.show_reading_publicly  — приватность (уже было)
-- Прогресс чтения продолжает жить в `profiles.last_read` — схема из tene
-- уже умеет его сохранять через RPC update_my_profile.
--
-- Проблема с `public.update_my_settings(data_to_update jsonb)` (мигр. 012):
--   settings = COALESCE(data_to_update->'settings', settings)
-- Это **полная замена** jsonb. Если клиент пишет только {reader: {...}},
-- он затрёт privacy-флаг и theme. Для частичных апдейтов нужен merge.
--
-- Решение: добавляем RPC `update_my_settings_patch(patch jsonb)`, который
-- делает JSONB concat (`settings = settings || patch`), т.е. поверх
-- существующего. Это безопасно для tene.fun: старый RPC никто не трогает,
-- новый — только для chaptify-клиента.
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_my_settings_patch(patch jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF patch IS NULL OR jsonb_typeof(patch) <> 'object' THEN
    RETURN;
  END IF;
  UPDATE public.profiles
  SET settings = COALESCE(settings, '{}'::jsonb) || patch
  WHERE id = auth.uid();
END $$;

GRANT EXECUTE ON FUNCTION public.update_my_settings_patch TO authenticated;
