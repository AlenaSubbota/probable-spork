-- ============================================================
-- 017: расписание переводчика
-- - translator_schedule (день недели + время + заметка)
-- - одна новелла может быть на нескольких днях (Пн/Ср/Пт)
-- - read all, write только владелец (переводчик своей записи)
-- Безопасно для tene: новая таблица, ничего не трогаем.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.translator_schedule (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  translator_id  uuid   NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  novel_id       bigint NOT NULL REFERENCES public.novels(id)   ON DELETE CASCADE,
  -- 0 = Понедельник ... 6 = Воскресенье (ISO-8601)
  day_of_week    smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  time_of_day    time,
  note           text CHECK (char_length(note) <= 200),
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- Одна и та же новелла в один и тот же день у переводчика не дублируется
  UNIQUE (translator_id, novel_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_schedule_translator
  ON public.translator_schedule (translator_id, day_of_week, sort_order);

CREATE INDEX IF NOT EXISTS idx_schedule_novel
  ON public.translator_schedule (novel_id);

ALTER TABLE public.translator_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schedule_read_all       ON public.translator_schedule;
DROP POLICY IF EXISTS schedule_owner_write    ON public.translator_schedule;
DROP POLICY IF EXISTS schedule_admin_override ON public.translator_schedule;

-- Читать может любой — это публичное расписание в профиле переводчика
CREATE POLICY schedule_read_all
  ON public.translator_schedule FOR SELECT
  USING (true);

-- Писать — только сам переводчик в свой слот
CREATE POLICY schedule_owner_write
  ON public.translator_schedule FOR ALL
  USING (auth.uid() = translator_id)
  WITH CHECK (auth.uid() = translator_id);

-- Админ может поправить/удалить чужой слот (если что-то неуместное)
CREATE POLICY schedule_admin_override
  ON public.translator_schedule FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND (is_admin = true OR role = 'admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND (is_admin = true OR role = 'admin')
  ));

GRANT SELECT                         ON public.translator_schedule TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.translator_schedule TO authenticated;
