-- ============================================================
-- 040: публичный view public_profiles + чистка orphan novel_translators
--
-- Контекст: на profiles стоит RLS «читать только свой профиль»
-- (legacy от tene). Из-за этого на chaptify падает 404 при заходе
-- на /t/[slug] и /u/[id], а в блоке «над новеллой работают»
-- появляются строки без имени (LEFT JOIN внутри view возвращает
-- профиль, но прямой SELECT — нет, отсюда мираж «два переводчика»:
-- одна реальная запись, вторая orphan от удалённого аккаунта).
--
-- Решение:
--   1. Создаём VIEW public_profiles с безопасными «публичными» колонками
--      и GRANT SELECT TO anon, authenticated. RLS на исходной таблице
--      profiles НЕ трогаем — личные поля (last_read, bookmarks, coin_balance,
--      subscription, payout_tribute_secret и т.п.) остаются под замком.
--   2. Бэкфилл-чистка: удаляем строки в novel_translators, которые ссылаются
--      на несуществующий профиль (orphan-юзер от тестов / удалённого аккаунта).
--      В будущем FK с ON DELETE CASCADE такого не допустит, но исторические
--      грязные данные надо вычистить.
--
-- Tene не трогаем: его SPA не ходит в новый view.
-- ============================================================

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
  -- show_reading_publicly выставляется в /profile/settings; по умолчанию true.
  COALESCE(
    (p.settings::jsonb)->>'show_reading_publicly',
    'true'
  )::boolean AS show_reading_publicly,
  -- last_read / bookmarks — только если юзер сам разрешил.
  -- Свой профиль читателю всё равно отдаст RLS на profiles напрямую.
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

-- Чистка orphan-строк в novel_translators (ссылка на удалённый/несуществующий
-- профиль → у NovelCredits нет данных и рендерится "Переводчик" без ссылки).
DELETE FROM public.novel_translators nt
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id = nt.user_id
);

-- Профилактика: для всех новелл с translator_id, которые есть в profiles,
-- гарантируем строку (novel_id, user_id, 'translator', share=100).
-- Дубль с триггером 039, но идемпотентен (ON CONFLICT) — пусть лишний раз.
INSERT INTO public.novel_translators (novel_id, user_id, role, share_percent, sort_order)
SELECT n.id, n.translator_id, 'translator', 100, 0
FROM public.novels n
JOIN public.profiles p ON p.id = n.translator_id
WHERE n.translator_id IS NOT NULL
ON CONFLICT (novel_id, user_id, role) DO NOTHING;
