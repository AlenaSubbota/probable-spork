-- ==========================================================================
-- 087_tg_auto_login_blocked
--
-- Реальный logout внутри Telegram Mini App. Раньше пользователь нажимал
-- «Выйти», супабейс-сессия очищалась, но при следующем рендере
-- TelegramMiniAppAutoLogin видел Telegram.WebApp.initData и тут же
-- залогинивал юзера обратно. Флаг tg_explicit_logout в localStorage
-- проблему не решал: WebView Mac TG Desktop теряет storage между
-- запусками Mini App.
--
-- Решение — серверный флаг в profiles. Логика:
--   1. На /auth/telegram c silent=true (фоновый автологин из Mini App)
--      auth-service-chaptify проверяет эту колонку. Если NOT NULL —
--      возвращает 403 auto_login_blocked, сессия не выдаётся.
--   2. На /auth/telegram c silent=false (явный клик «Войти») сервис
--      сбрасывает колонку обратно в NULL и выдаёт сессию как раньше.
--   3. Кнопка «Выйти» в Mini App дёргает новый endpoint /auth/telegram/block,
--      который ставит NOW(), затем фронт делает supabase.auth.signOut().
--
-- Колонка nullable: NULL = автологин разрешён (дефолт для всех текущих
-- юзеров и новичков). Мигрируем без backfill.
-- ==========================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tg_auto_login_blocked_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.tg_auto_login_blocked_at IS
  'NOT NULL → silent-автологин из TG Mini App запрещён. Сбрасывается auth-service-chaptify при явном входе через виджет/кнопку.';
