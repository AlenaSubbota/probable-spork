-- =====================================================================
-- 074_random_public_quotes: справедливый рандом по всем цитатам
-- ---------------------------------------------------------------------
-- Прежняя `random_public_quote()` сначала брала топ-200 свежих
-- публичных цитат и уже из них доставала случайную. Из-за этого старые
-- цитаты вне топ-200 на главной никогда не появлялись — даже если
-- редакция собирала «коллекцию», более ранние цитаты выпадали из
-- ротации. Алёна попросила, чтобы при сотне цитат каждая хотя бы раз
-- мелькала на главной.
--
-- Что меняем:
-- 1. `random_public_quote()` — снимаем LIMIT 200, теперь random()
--    бежит по всем публичным цитатам.
-- 2. Добавляем `random_public_quotes(p_limit int)` — отдаёт сразу
--    несколько разных случайных цитат за один запрос (используется на
--    главной для полосы из 3-х).
--
-- Производительность: user_quotes — десятки тысяч строк максимум,
-- ORDER BY random() приемлемо. Если когда-нибудь раздуется до
-- миллионов — переедем на TABLESAMPLE.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.random_public_quote()
RETURNS TABLE (
  id             bigint,
  quote_text     text,
  chapter_number int,
  created_at     timestamptz,
  author_name    text,
  novel_id       bigint,
  novel_title    text,
  novel_firebase_id text
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH picked AS (
    SELECT q.*
    FROM public.user_quotes q
    WHERE q.is_public = true
    ORDER BY random()
    LIMIT 1
  )
  SELECT
    p.id,
    p.quote_text,
    p.chapter_number,
    p.created_at,
    COALESCE(pr.user_name, 'Читатель')   AS author_name,
    n.id,
    n.title,
    n.firebase_id
  FROM picked p
  LEFT JOIN public.profiles pr ON pr.id = p.user_id
  LEFT JOIN public.novels   n  ON n.id  = p.novel_id;
$$;

GRANT EXECUTE ON FUNCTION public.random_public_quote() TO anon, authenticated;

-- Множественная версия: одной выборкой берём p_limit разных цитат.
-- Лимит сверху ограничен 12, чтобы случайный запрос с большим n не
-- стал мини-DDoS'ом. Дедупликации не нужно — random() + DISTINCT'ить
-- не приходится, т.к. одна и та же строка не выберется дважды.
CREATE OR REPLACE FUNCTION public.random_public_quotes(p_limit int DEFAULT 3)
RETURNS TABLE (
  id             bigint,
  quote_text     text,
  chapter_number int,
  created_at     timestamptz,
  author_name    text,
  novel_id       bigint,
  novel_title    text,
  novel_firebase_id text
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH picked AS (
    SELECT q.*
    FROM public.user_quotes q
    WHERE q.is_public = true
    ORDER BY random()
    LIMIT GREATEST(1, LEAST(p_limit, 12))
  )
  SELECT
    p.id,
    p.quote_text,
    p.chapter_number,
    p.created_at,
    COALESCE(pr.user_name, 'Читатель')   AS author_name,
    n.id,
    n.title,
    n.firebase_id
  FROM picked p
  LEFT JOIN public.profiles pr ON pr.id = p.user_id
  LEFT JOIN public.novels   n  ON n.id  = p.novel_id;
$$;

GRANT EXECUTE ON FUNCTION public.random_public_quotes(int) TO anon, authenticated;
