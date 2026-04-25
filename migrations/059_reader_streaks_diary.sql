-- ============================================================
-- 059: читательский стрик + дневник прочтённого
--
-- Killer-фича уровня Duolingo+Spotify Wrapped, но для чтения. Каждое
-- открытие главы засчитывается в стрик; после прочтения читатель
-- может тапом «оставить закладку дня» — эмодзи настроения + цитата.
-- Это превращает сухой счётчик в личную летопись отношений с книгами,
-- которую страшно потерять (loss aversion + identity).
--
-- Структура:
--   reading_streaks       — одна строка на юзера. Текущий и лучший стрик,
--                           доступные «заморозки», дата последней отметки.
--   reading_diary_entries — N записей на юзера. Эмоция + цитата + новелла +
--                           глава + дата. Для календаря и месячных wrap'ов.
--
-- Tene не трогаем: обе таблицы новые, на старые он смотрит так же.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.reading_streaks (
  user_id              uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  current_length       int NOT NULL DEFAULT 0 CHECK (current_length >= 0),
  best_length          int NOT NULL DEFAULT 0 CHECK (best_length >= 0),
  last_check_in_date   date,
  freezes_available    int NOT NULL DEFAULT 0 CHECK (freezes_available >= 0),
  freezes_earned_total int NOT NULL DEFAULT 0,
  freezes_used_total   int NOT NULL DEFAULT 0,
  total_check_ins      int NOT NULL DEFAULT 0,
  total_diary_entries  int NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reading_streaks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rs_self_read   ON public.reading_streaks;
DROP POLICY IF EXISTS rs_self_write  ON public.reading_streaks;

-- Стрик читает и пишет только сам юзер. Публичных rank'ов пока нет —
-- если захотим лидерборд, делаем через view с агрегатами, не открывая
-- таблицу.
CREATE POLICY rs_self_read
  ON public.reading_streaks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY rs_self_write
  ON public.reading_streaks FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reading_streaks TO authenticated;

-- ============================================================
-- reading_diary_entries: микрозаписи
-- ============================================================
CREATE TABLE IF NOT EXISTS public.reading_diary_entries (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id         uuid   NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  novel_id        bigint REFERENCES public.novels(id) ON DELETE SET NULL,
  chapter_number  int,
  entry_date      date   NOT NULL DEFAULT current_date,
  -- Эмодзи настроения. Открытый text, но фронт ограничен пресетом —
  -- тогда статистика по эмоциям будет осмысленной. Длина 8 чтобы
  -- влез составной emoji (с ZWJ-склейками).
  emotion         text   CHECK (emotion IS NULL OR length(emotion) <= 8),
  -- Цитата, которая запомнилась. До 600 символов — чтобы крупный
  -- параграф влез, но без полглавы.
  quote           text   CHECK (quote IS NULL OR length(quote) <= 600),
  -- Своя короткая мысль («ревела весь вечер»). До 280, как Twitter —
  -- не разрастается в эссе, но достаточно для эмоции.
  note            text   CHECK (note IS NULL OR length(note) <= 280),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diary_user_date
  ON public.reading_diary_entries (user_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_diary_user_novel
  ON public.reading_diary_entries (user_id, novel_id, entry_date DESC);

ALTER TABLE public.reading_diary_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rde_self_read   ON public.reading_diary_entries;
DROP POLICY IF EXISTS rde_self_write  ON public.reading_diary_entries;

-- Дневник видит и пишет только сам юзер. Никаких публичных лент.
CREATE POLICY rde_self_read
  ON public.reading_diary_entries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY rde_self_write
  ON public.reading_diary_entries FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reading_diary_entries TO authenticated;

-- ============================================================
-- RPC reader_check_in
--
-- Вызывается при открытии главы (server-side из chapter page). Сама
-- логика стрика:
--   today      = current_date (UTC; для MSK ничего критичного, мы
--                 толерантны к ±1 часу полуночи)
--   prev_date  = reading_streaks.last_check_in_date
--   gap        = today - prev_date в днях
--
--   gap = 0   → юзер уже отмечался сегодня. Ничего не меняем, только
--              обновляем total_check_ins.
--   gap = 1   → отметка день-в-день. current_length += 1.
--   gap >= 2  → пропуск. Если есть freezes_available и gap-1 ≤ freezes,
--              «потратим» столько заморозок, сколько надо, чтобы стрик
--              выжил. Иначе — стрик сгорает, current_length = 1.
--   prev IS NULL → первый раз. current_length = 1.
--
-- best_length всегда max(best_length, current_length).
-- updated_at — touch.
--
-- Возвращает строку reading_streaks (для оптимистичного UI).
-- ============================================================
CREATE OR REPLACE FUNCTION public.reader_check_in()
RETURNS public.reading_streaks
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_today     date := current_date;
  v_row       public.reading_streaks%ROWTYPE;
  v_gap       int;
  v_freeze_use int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_row FROM public.reading_streaks WHERE user_id = v_uid;

  IF NOT FOUND THEN
    -- Первая отметка: создаём запись со стриком 1.
    INSERT INTO public.reading_streaks
      (user_id, current_length, best_length, last_check_in_date,
       total_check_ins)
    VALUES
      (v_uid, 1, 1, v_today, 1)
    RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  IF v_row.last_check_in_date = v_today THEN
    -- Уже отмечались сегодня. Просто увеличим total_check_ins
    -- (полезно для статы «сколько глав сегодня»).
    UPDATE public.reading_streaks
    SET total_check_ins = total_check_ins + 1,
        updated_at      = now()
    WHERE user_id = v_uid
    RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  IF v_row.last_check_in_date IS NULL THEN
    v_gap := 9999;  -- considered as «новая серия с нуля»
  ELSE
    v_gap := v_today - v_row.last_check_in_date;
  END IF;

  IF v_gap = 1 THEN
    -- Сосед-день: продолжаем серию.
    UPDATE public.reading_streaks
    SET current_length     = current_length + 1,
        best_length        = GREATEST(best_length, current_length + 1),
        last_check_in_date = v_today,
        total_check_ins    = total_check_ins + 1,
        updated_at         = now()
    WHERE user_id = v_uid
    RETURNING * INTO v_row;
  ELSE
    -- gap >= 2: пропуск. Сколько заморозок потратить, чтобы выжить?
    -- Заморозка спасает один пропущенный день. gap=2 → 1 заморозка
    -- закрывает «вчера», стрик продолжается.
    v_freeze_use := LEAST(v_row.freezes_available, v_gap - 1);

    IF v_freeze_use = v_gap - 1 THEN
      -- Хватило заморозок: серия живёт, тратим, +1 за сегодня.
      UPDATE public.reading_streaks
      SET current_length      = current_length + 1,
          best_length         = GREATEST(best_length, current_length + 1),
          last_check_in_date  = v_today,
          freezes_available   = freezes_available - v_freeze_use,
          freezes_used_total  = freezes_used_total + v_freeze_use,
          total_check_ins     = total_check_ins + 1,
          updated_at          = now()
      WHERE user_id = v_uid
      RETURNING * INTO v_row;
    ELSE
      -- Не хватило: огонь гаснет. Начинаем заново со стриком 1.
      UPDATE public.reading_streaks
      SET current_length      = 1,
          last_check_in_date  = v_today,
          freezes_available   = 0,
          freezes_used_total  = freezes_used_total + v_freeze_use,
          total_check_ins     = total_check_ins + 1,
          updated_at          = now()
      WHERE user_id = v_uid
      RETURNING * INTO v_row;
    END IF;
  END IF;

  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION public.reader_check_in() TO authenticated;

-- ============================================================
-- RPC add_diary_entry — оставить запись «закладка дня».
--
-- Опциональные emotion / quote / note (хотя бы что-то одно должно быть).
-- Каждая запись «зарабатывает» инкремент к total_diary_entries; за
-- каждые 5 записей подряд (по дням) накидывается +1 заморозка.
-- ============================================================
CREATE OR REPLACE FUNCTION public.add_diary_entry(
  p_novel_id       bigint,
  p_chapter_number int,
  p_emotion        text,
  p_quote          text,
  p_note           text
) RETURNS public.reading_diary_entries
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_row       public.reading_diary_entries%ROWTYPE;
  v_streak    public.reading_streaks%ROWTYPE;
  v_clean_e   text := NULLIF(btrim(p_emotion), '');
  v_clean_q   text := NULLIF(btrim(p_quote),   '');
  v_clean_n   text := NULLIF(btrim(p_note),    '');
  v_diary_cnt int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF v_clean_e IS NULL AND v_clean_q IS NULL AND v_clean_n IS NULL THEN
    RAISE EXCEPTION 'empty entry';
  END IF;

  INSERT INTO public.reading_diary_entries
    (user_id, novel_id, chapter_number, emotion, quote, note)
  VALUES
    (v_uid, p_novel_id, p_chapter_number, v_clean_e, v_clean_q, v_clean_n)
  RETURNING * INTO v_row;

  -- Накинуть инкремент в стриковую запись (создать если нужно)
  INSERT INTO public.reading_streaks (user_id, total_diary_entries)
  VALUES (v_uid, 1)
  ON CONFLICT (user_id) DO UPDATE
    SET total_diary_entries = reading_streaks.total_diary_entries + 1,
        updated_at = now()
  RETURNING * INTO v_streak;

  -- За каждые 5 записей в дневнике — +1 заморозка. Считаем общее число
  -- записей этого юзера и проверяем «перешли ли через границу 5N».
  -- Если total_diary_entries после инкремента кратно 5 — выдаём.
  IF v_streak.total_diary_entries > 0
     AND v_streak.total_diary_entries % 5 = 0 THEN
    UPDATE public.reading_streaks
    SET freezes_available    = freezes_available + 1,
        freezes_earned_total = freezes_earned_total + 1,
        updated_at           = now()
    WHERE user_id = v_uid;
  END IF;

  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION public.add_diary_entry(bigint, int, text, text, text)
  TO authenticated;

-- ============================================================
-- View diary_calendar_view — агрегат по дням для календарной сетки.
-- На каждую дату: количество записей + одна «представительская» эмоция
-- (последняя добавленная). Используется для месячного календаря.
-- ============================================================
CREATE OR REPLACE VIEW public.diary_calendar_view AS
SELECT
  d.user_id,
  d.entry_date,
  count(*)::int AS entries_count,
  -- emotion последней записи дня (для подсветки в календаре)
  (array_agg(d.emotion ORDER BY d.created_at DESC) FILTER (WHERE d.emotion IS NOT NULL))[1]
    AS last_emotion
FROM public.reading_diary_entries d
GROUP BY d.user_id, d.entry_date;

ALTER VIEW public.diary_calendar_view OWNER TO supabase_admin;
GRANT SELECT ON public.diary_calendar_view TO authenticated;

-- ============================================================
-- Touch updated_at в reading_streaks
-- ============================================================
CREATE OR REPLACE FUNCTION public.touch_reading_streaks_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_reading_streaks_updated_at ON public.reading_streaks;
CREATE TRIGGER trg_reading_streaks_updated_at
  BEFORE UPDATE ON public.reading_streaks
  FOR EACH ROW EXECUTE FUNCTION public.touch_reading_streaks_updated_at();
