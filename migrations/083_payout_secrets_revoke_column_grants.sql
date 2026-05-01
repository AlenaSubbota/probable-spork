-- ============================================================
-- 083: C7 — payout secrets в profiles доступны через PostgREST.
--
-- Проблема (мигр. 010:9-15):
--   profiles.payout_tribute_secret и profiles.payout_tribute_webhook_token —
--   это HMAC-секреты для проверки Tribute-вебхуков. Они лежат в
--   общедоступной таблице profiles вместе с user_name, avatar_url,
--   и т.д. RLS на profiles может разрешить чтение (например другому
--   члену команды или админу) — и эти HMAC-секреты утекут наружу
--   через любой `select('*')`.
--
-- Решение: column-level REVOKE SELECT на чувствительные колонки.
-- После этого:
--   - SELECT * FROM profiles → permission denied (любой кто пробует)
--   - SELECT role, is_admin FROM profiles → работает
--   - SECURITY DEFINER функции (consume_boosty_connect_token,
--     apply_tribute_event, get_translator_by_webhook_token и т.д.) —
--     работают, потому что они выполняются от имени owner'а функции
--     (postgres) и игнорируют column-level grants caller'а.
--
-- ВАЖНО: эта миграция применяется одновременно с клиентским патчем,
-- который заменяет два `select('*')` в src/app/novel/[id]/page.tsx и
-- src/app/novel/[id]/[chapterNum]/page.tsx на explicit column lists.
-- Без патча эти страницы начнут отдавать 400 / `permission denied`.
-- ============================================================

REVOKE SELECT (payout_tribute_secret, payout_tribute_webhook_token)
  ON public.profiles
  FROM authenticated, anon, public;

COMMENT ON COLUMN public.profiles.payout_tribute_secret IS
  'HMAC-секрет для проверки Tribute webhook payload. ОТЗЫВАН на column-level '
  'для anon/authenticated; читается ТОЛЬКО SECURITY DEFINER функциями '
  '(get_translator_by_webhook_token и т.п.).';

COMMENT ON COLUMN public.profiles.payout_tribute_webhook_token IS
  'Tribute webhook token (URL-path сегмент). ОТЗЫВАН на column-level '
  'для anon/authenticated; читается ТОЛЬКО SECURITY DEFINER функциями.';

-- ============================================================
-- Откат (если что-то сломалось):
--
--   GRANT SELECT (payout_tribute_secret, payout_tribute_webhook_token)
--     ON public.profiles TO authenticated, anon;
--
-- (но это вернёт уязвимость — лучше пофиксить вызывающий код.)
-- ============================================================
