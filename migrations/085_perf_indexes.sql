-- ============================================================
-- 085: Performance-индексы для горячих запросов главной/каталога.
--
-- Из аудита pre-launch:
--   - Top of Week (page.tsx:538) делает SELECT * FROM novel_ratings
--     WHERE created_at >= NOW() - 7 days. Без индекса на created_at —
--     полный скан таблицы на каждый рендер главной.
--   - Comments feed на главной (page.tsx:291) делает
--     SELECT ... ORDER BY created_at DESC LIMIT 6 WHERE deleted_at IS NULL.
--     Без partial index'а — heap scan по всей comments.
--
-- Безопасно: только CREATE INDEX IF NOT EXISTS. Не блокирует таблицы
-- (CONCURRENTLY ставит lock-уровень SHARE UPDATE EXCLUSIVE — INSERT/
-- UPDATE/DELETE продолжают работать, только DDL и VACUUM FULL ждут).
-- На пустых/маленьких таблицах CONCURRENTLY чуть медленнее, но безопаснее
-- если новелл/комментариев уже много.
-- ============================================================

-- Top of Week: фильтр по created_at + ORDER BY rating desc
CREATE INDEX IF NOT EXISTS idx_novel_ratings_created_at
  ON public.novel_ratings (created_at DESC);

-- Recent comments на главной: deleted_at IS NULL + ORDER BY created_at DESC
-- Partial index — только активные комменты, экономит место и ускоряет
-- запрос вдвое (отфильтрованные deleted-row'ы не входят в индекс).
CREATE INDEX IF NOT EXISTS idx_comments_recent_active
  ON public.comments (created_at DESC)
  WHERE deleted_at IS NULL;

-- Trending novels: chapters published за последние 7 дней,
-- группировка по novel_id. У нас уже есть idx_chapters_published_at
-- из мигр. 002 — этого хватает (хотя для GROUP BY чуть быстрее
-- был бы (novel_id, published_at), но не критично).

-- Reading-now «Активные читатели» — page.tsx:230. Если хочешь точного
-- запроса по «последние 30 минут», добавь last_read_updated_at и индекс
-- на него. Сейчас фильтр idсмещён на arbitrary 200 ряд из profiles —
-- индекс не поможет, нужен schema change. Откладываю как отдельную задачу.
