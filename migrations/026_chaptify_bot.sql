-- ============================================================
-- 026: поддержка отдельного Telegram-бота для chaptify
-- - profiles.chaptify_bot_chat_id  — telegram chat_id, куда бот может
--   писать пользователю. Задаётся когда юзер написал /start боту.
--   (tene-бот не использует это поле и не затронут.)
-- - profiles.chaptify_notifications — опт-аут для пуш-уведомлений из
--   бота. По умолчанию true; /stop в боте выставляет false.
-- - chaptify_bot_sent (notification_id, chat_id, sent_at) — лог
--   отправленного, чтобы не дублировать при перезапуске бота.
-- Безопасно для tene: новые колонки/таблица, tene о них не знает.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS chaptify_bot_chat_id   bigint,
  ADD COLUMN IF NOT EXISTS chaptify_notifications boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_profiles_chaptify_bot
  ON public.profiles (chaptify_bot_chat_id)
  WHERE chaptify_bot_chat_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.chaptify_bot_sent (
  notification_id bigint NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  chat_id         bigint NOT NULL,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, chat_id)
);

CREATE INDEX IF NOT EXISTS idx_chaptify_bot_sent_at
  ON public.chaptify_bot_sent (sent_at DESC);

-- Таблица служебная, доступ только service_role (никто через UI не пишет)
ALTER TABLE public.chaptify_bot_sent ENABLE ROW LEVEL SECURITY;
-- Без политик → anon/authenticated ничего не увидят, только сервис-ключ
-- от бота сможет писать.
