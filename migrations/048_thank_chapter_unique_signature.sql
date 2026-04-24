-- ============================================================
-- Миграция 048: фикс overloaded thank_chapter
--
-- Алёна: «Сказать "спасибо" после главы — Could not choose the best
-- candidate function between: public.thank_chapter(bigint,int,int),
-- public.thank_chapter(bigint,int,int,text)».
--
-- Проблема: мигр. 045 создала 2 функции с одинаковым префиксом
-- параметров (3-арная и 4-арная через DEFAULT NULL у p_message).
-- PostgREST при вызове `supabase.rpc('thank_chapter', {p_novel,
-- p_chapter, p_tip_coins})` не может однозначно выбрать кандидата.
--
-- Решение: удаляем 4-арную версию. Клиент chaptify посылает 3
-- параметра (см. src/components/reader/ChapterThanks.tsx:63-67) —
-- 3-арная функция покрывает все текущие вызовы. 4-арная была оставлена
-- исключительно на случай старого клиента, но поиск по репозиторию
-- такие вызовы не нашёл.
--
-- Безопасно для tene: tene RPC-ом thank_chapter не пользуется.
-- ============================================================

DROP FUNCTION IF EXISTS public.thank_chapter(bigint, int, int, text);

-- 3-арная версия из мигр. 045 остаётся как есть — уже социальная
-- (монеты не списывает), tip_coins игнорируется для обратной совместимости.
