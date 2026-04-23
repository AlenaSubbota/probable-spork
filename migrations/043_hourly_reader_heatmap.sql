-- ============================================================
-- 043: тепловая карта «когда читают» для переводчика
--
-- На /admin/analytics нужен ответ «в какое время публиковать главу,
-- чтобы её сразу прочли». Считаем по reading_days + last_read-timestamp:
-- для каждого часа (0..23) и дня недели (0..6, 0=Пн) — сколько
-- открытий глав из новелл переводчика за последние 30 дней.
--
-- Используем коротко-живущий индекс по chapters.novel_id (уже есть в
-- миграции 002). Сама выборка тяжёлая, поэтому кэшируем результат
-- в приложении (server-side rendering + revalidate).
--
-- Безопасность: RPC проверяет, что вызывающий — сам translator или
-- admin. Другие пользователи получают ошибку — незачем сливать
-- активность читателей другого переводчика.
-- ============================================================

CREATE OR REPLACE FUNCTION public.translator_hourly_heatmap(
  p_translator uuid,
  p_days       int DEFAULT 30
) RETURNS TABLE (
  dow    int,   -- день недели 0=Пн..6=Вс (ISO-дашнее смещение)
  hour   int,   -- 0..23, в UTC (фронт сместит в локаль при необходимости)
  reads  int    -- сколько раз открывалась глава этого автора
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me       uuid := auth.uid();
  v_is_admin boolean := false;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 180 THEN
    p_days := 30;
  END IF;

  SELECT (is_admin = true OR role = 'admin')
  INTO v_is_admin
  FROM public.profiles WHERE id = v_me;

  IF v_me <> p_translator AND v_is_admin IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH novels_of AS (
    SELECT id FROM public.novels WHERE translator_id = p_translator
  ),
  reads_raw AS (
    -- Из last_read вытаскиваем все timestamps (последняя запись на новеллу)
    -- + из reading_days — агрегат по дням. last_read точнее по часу, поэтому
    -- базовый источник он, reading_days нужен для размазывания плотности.
    SELECT (lr.value->>'timestamp')::timestamptz AS ts
    FROM public.profiles p,
         LATERAL jsonb_each(COALESCE(p.last_read, '{}'::jsonb)) lr
    WHERE p.last_read IS NOT NULL
      AND (lr.value->>'novelId')::bigint IN (SELECT id FROM novels_of)
      AND (lr.value->>'timestamp')::timestamptz >= now() - (p_days || ' days')::interval
  )
  SELECT
    ((EXTRACT(ISODOW FROM ts)::int - 1) % 7) AS dow,
    EXTRACT(HOUR FROM ts)::int               AS hour,
    COUNT(*)::int                            AS reads
  FROM reads_raw
  GROUP BY 1, 2
  ORDER BY 1, 2;
END $$;

GRANT EXECUTE ON FUNCTION public.translator_hourly_heatmap(uuid, int) TO authenticated;
