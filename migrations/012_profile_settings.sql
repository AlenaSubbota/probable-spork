-- ============================================================
-- Миграция 012: настройки профиля (аватар, приватность)
-- - profiles.avatar_url — универсальный аватар пользователя
-- - RPC update_my_settings — обновляет безопасный набор полей
-- - avatars-бакет в storage с RLS
-- Безопасно для tene.fun: только ADD/INSERT IF NOT EXISTS.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- ---- RPC для обновления настроек профиля пользователем ----
-- Обновляет строго безопасный набор полей. Остальное нельзя трогать
-- через этот RPC (telegram_id, email, role — только через админа).
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
    settings                 = COALESCE(data_to_update->'settings',                  settings)
  WHERE id = auth.uid();
END $$;

GRANT EXECUTE ON FUNCTION public.update_my_settings TO authenticated;

-- ---- Storage: bucket avatars ----
-- Создаём публичный бакет, если его ещё нет. В selfhosted Supabase
-- таблица storage.buckets принимает INSERT от владельца.
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- ---- RLS политики для avatars ----
-- Файлы кладём в `avatars/<user_id>/<filename>`. Каждый юзер имеет
-- право писать/удалять только свою папку, читать — все.

-- Public read
DROP POLICY IF EXISTS avatars_read_public ON storage.objects;
CREATE POLICY avatars_read_public
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

-- Authenticated write to own folder
DROP POLICY IF EXISTS avatars_owner_insert ON storage.objects;
CREATE POLICY avatars_owner_insert
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS avatars_owner_update ON storage.objects;
CREATE POLICY avatars_owner_update
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS avatars_owner_delete ON storage.objects;
CREATE POLICY avatars_owner_delete
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
