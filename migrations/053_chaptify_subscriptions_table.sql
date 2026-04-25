-- ============================================================
-- 053: chaptify_subscriptions — изоляция от tene
-- Шаг 1/3: новая таблица + копирование данных + RLS/GRANT/индексы.
--
-- Контекст: таблица public.subscriptions используется и tene-фронтом
-- (через public.can_read_chapter), и chaptify-бэком. Чтобы chaptify
-- мог писать своё, не задевая tene-логику, заводим отдельную таблицу
-- public.chaptify_subscriptions с той же структурой, копируем туда
-- текущие записи (все они исторически были созданы chaptify-кодом),
-- и в шагах 2/3 переписываем chaptify-RPC на новую таблицу.
--
-- public.subscriptions остаётся как есть для tene — никаких ALTER'ов.
-- public.can_read_chapter (общий, tene-флоу) тоже не трогаем.
-- ============================================================

-- 1) Структура — точная копия subscriptions
CREATE TABLE IF NOT EXISTS public.chaptify_subscriptions (
  LIKE public.subscriptions INCLUDING ALL
);

-- 2) Копируем все текущие строки с сохранением id (чтобы не сломать
-- ссылки в notifications, в админке и т.п.). OVERRIDING SYSTEM VALUE
-- разрешает явное значение в GENERATED ALWAYS AS IDENTITY.
INSERT INTO public.chaptify_subscriptions
  OVERRIDING SYSTEM VALUE
SELECT * FROM public.subscriptions
ON CONFLICT DO NOTHING;

-- 3) Подгоняем sequence к max(id), чтобы новые INSERT'ы не падали
-- на конфликте PK.
SELECT setval(
  pg_get_serial_sequence('public.chaptify_subscriptions', 'id'),
  COALESCE((SELECT MAX(id) FROM public.chaptify_subscriptions), 0) + 1,
  false
);

-- 4) Те же GRANT'ы, что и у subscriptions (мигр. 001)
GRANT SELECT, INSERT ON public.chaptify_subscriptions TO authenticated;

-- 5) RLS — фактически как у subscriptions (без жёстких политик: tene не
-- ставил их). Включаем RLS для будущей безопасности; политики добавим
-- позже отдельной миграцией, когда стиль стабилизируется.
ALTER TABLE public.chaptify_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chap_subs_self_read       ON public.chaptify_subscriptions;
DROP POLICY IF EXISTS chap_subs_translator_read ON public.chaptify_subscriptions;
DROP POLICY IF EXISTS chap_subs_admin_all       ON public.chaptify_subscriptions;

-- Читатель видит свои подписки (для /profile/subscriptions)
CREATE POLICY chap_subs_self_read
  ON public.chaptify_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- Переводчик видит своих подписчиков (для /admin/subscribers)
CREATE POLICY chap_subs_translator_read
  ON public.chaptify_subscriptions FOR SELECT
  USING (auth.uid() = translator_id);

-- Админ — всё
CREATE POLICY chap_subs_admin_all
  ON public.chaptify_subscriptions FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = true OR role = 'admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = true OR role = 'admin')
  ));

-- 6) Индекс на (user_id, status) — как в 001 для исходной таблицы.
-- LIKE INCLUDING ALL уже копирует индексы, но имя у них автоген.
-- На всякий случай создаём свой именованный.
CREATE INDEX IF NOT EXISTS idx_chap_subs_user_status
  ON public.chaptify_subscriptions (user_id, status);

CREATE INDEX IF NOT EXISTS idx_chap_subs_translator_status
  ON public.chaptify_subscriptions (translator_id, status, expires_at DESC);

-- ВАЖНО: уникальность по (user_id, translator_id, plan, provider) —
-- это требует ON CONFLICT в RPC. Проверяем что INCLUDING ALL её скопировал.
-- Если по какой-то причине нет — добавляем.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.chaptify_subscriptions'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%user_id%translator_id%plan%provider%'
  ) THEN
    ALTER TABLE public.chaptify_subscriptions
      ADD CONSTRAINT chap_subs_unique_per_provider
      UNIQUE (user_id, translator_id, plan, provider);
  END IF;
END $$;
