-- ============================================================
-- Миграция 005: reading_days для читательского стрика
-- Зависит от 001–004. Безопасно для tene.fun.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.reading_days (
  user_id        uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day            date    NOT NULL,
  chapters_read  integer NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, day)
);

CREATE INDEX IF NOT EXISTS idx_reading_days_user_day
  ON public.reading_days (user_id, day DESC);

ALTER TABLE public.reading_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reading_days_self_read ON public.reading_days;

CREATE POLICY reading_days_self_read
  ON public.reading_days FOR SELECT
  USING (auth.uid() = user_id);

GRANT SELECT ON public.reading_days TO authenticated;

-- RPC: вызывается при каждом сохранении прогресса в читалке.
-- Инкрементирует счётчик за текущий день.
CREATE OR REPLACE FUNCTION public.log_reading_day()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;

  INSERT INTO public.reading_days (user_id, day, chapters_read)
  VALUES (auth.uid(), CURRENT_DATE, 1)
  ON CONFLICT (user_id, day)
  DO UPDATE SET chapters_read = public.reading_days.chapters_read + 1;
END $$;

GRANT EXECUTE ON FUNCTION public.log_reading_day TO authenticated;

-- Бэкфилл: засеять reading_days из profiles.last_read
-- (каждая запись last_read = 1 день активности).
CREATE OR REPLACE FUNCTION public.backfill_reading_days_from_last_read()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  inserted int := 0;
BEGIN
  WITH extracted AS (
    SELECT
      p.id AS user_id,
      (entry.value ->> 'timestamp')::timestamptz AS ts
    FROM public.profiles p
    CROSS JOIN LATERAL jsonb_each(COALESCE(p.last_read, '{}'::jsonb)) AS entry
    WHERE p.last_read IS NOT NULL
      AND entry.value ? 'timestamp'
  )
  INSERT INTO public.reading_days (user_id, day, chapters_read)
  SELECT user_id, ts::date, COUNT(*)::int
  FROM extracted
  WHERE ts IS NOT NULL
  GROUP BY user_id, ts::date
  ON CONFLICT (user_id, day) DO NOTHING;

  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END $$;

-- Запускаем бэкфилл сразу (один раз).
SELECT public.backfill_reading_days_from_last_read();

-- RPC: получить стрик пользователя (текущий + рекорд) и дни последних 90 дней
CREATE OR REPLACE FUNCTION public.get_reading_activity(
  p_user uuid DEFAULT NULL,
  p_days int DEFAULT 90
) RETURNS TABLE (
  day           date,
  chapters      int
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH target_user AS (
    SELECT COALESCE(p_user, auth.uid()) AS uid
  ),
  days AS (
    SELECT generate_series(
      (CURRENT_DATE - (p_days - 1))::date,
      CURRENT_DATE,
      '1 day'::interval
    )::date AS d
  )
  SELECT
    days.d AS day,
    COALESCE(rd.chapters_read, 0) AS chapters
  FROM days
  CROSS JOIN target_user
  LEFT JOIN public.reading_days rd
    ON rd.user_id = target_user.uid
   AND rd.day    = days.d
  ORDER BY days.d;
$$;

GRANT EXECUTE ON FUNCTION public.get_reading_activity TO authenticated;
