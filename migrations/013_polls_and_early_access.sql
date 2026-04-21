-- ============================================================
-- Миграция 013: голосование за новеллы + ранний доступ к главам
--
-- 1) polls / poll_options / poll_votes — опрос на главной:
--    «Какую новеллу переводить следующей?». Переводчик (или админ)
--    создаёт опрос, читатели голосуют. Один голос на юзера.
--
-- 2) chapters.early_access_until — пометка, до какого момента глава
--    доступна ТОЛЬКО подписчикам (или покупателям). После даты
--    глава становится бесплатной/платной обычным путём.
-- ============================================================

-- ---- POLLS ----

CREATE TABLE IF NOT EXISTS public.polls (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title         text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
  description   text,
  author_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_active     boolean NOT NULL DEFAULT true,
  ends_at       timestamptz,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_polls_active
  ON public.polls (is_active, created_at DESC);

CREATE TABLE IF NOT EXISTS public.poll_options (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  poll_id     bigint NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  cover_url   text,        -- обложка потенциальной новеллы (imho мокап)
  external_link text,      -- ссылка на оригинал (novelupdates и т.п.)
  sort_order  integer DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_poll_options_poll
  ON public.poll_options (poll_id, sort_order);

CREATE TABLE IF NOT EXISTS public.poll_votes (
  poll_id   bigint NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  option_id bigint NOT NULL REFERENCES public.poll_options(id) ON DELETE CASCADE,
  voted_at  timestamptz DEFAULT now(),
  PRIMARY KEY (poll_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_poll_votes_option
  ON public.poll_votes (option_id);

-- RLS: читать опросы и опции — все; голоса — только свои.
-- Админ/переводчик пишет опросы и опции.
ALTER TABLE public.polls        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poll_votes   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS polls_read_all   ON public.polls;
DROP POLICY IF EXISTS polls_admin_all  ON public.polls;
DROP POLICY IF EXISTS options_read_all ON public.poll_options;
DROP POLICY IF EXISTS options_admin    ON public.poll_options;
DROP POLICY IF EXISTS votes_self_select ON public.poll_votes;
DROP POLICY IF EXISTS votes_self_insert ON public.poll_votes;
DROP POLICY IF EXISTS votes_self_delete ON public.poll_votes;

CREATE POLICY polls_read_all
  ON public.polls FOR SELECT USING (true);

CREATE POLICY polls_admin_all
  ON public.polls FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles
                 WHERE id = auth.uid()
                   AND (is_admin = true OR role IN ('admin','translator'))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles
                      WHERE id = auth.uid()
                        AND (is_admin = true OR role IN ('admin','translator'))));

CREATE POLICY options_read_all
  ON public.poll_options FOR SELECT USING (true);

CREATE POLICY options_admin
  ON public.poll_options FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles
                 WHERE id = auth.uid()
                   AND (is_admin = true OR role IN ('admin','translator'))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles
                      WHERE id = auth.uid()
                        AND (is_admin = true OR role IN ('admin','translator'))));

CREATE POLICY votes_self_select
  ON public.poll_votes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY votes_self_insert
  ON public.poll_votes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY votes_self_delete
  ON public.poll_votes FOR DELETE
  USING (auth.uid() = user_id);

GRANT SELECT                         ON public.polls        TO authenticated, anon;
GRANT SELECT                         ON public.poll_options TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.polls        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.poll_options TO authenticated;
GRANT SELECT, INSERT, DELETE         ON public.poll_votes   TO authenticated;

-- RPC: результаты опроса с процентами (для показа на главной)
CREATE OR REPLACE FUNCTION public.poll_results(p_poll bigint)
RETURNS TABLE (
  option_id    bigint,
  title        text,
  description  text,
  cover_url    text,
  external_link text,
  votes        bigint,
  pct          numeric
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH total AS (
    SELECT COUNT(*)::bigint AS n FROM public.poll_votes WHERE poll_id = p_poll
  )
  SELECT
    o.id, o.title, o.description, o.cover_url, o.external_link,
    COUNT(v.user_id)::bigint AS votes,
    CASE WHEN (SELECT n FROM total) > 0
         THEN ROUND(COUNT(v.user_id) * 100.0 / (SELECT n FROM total), 1)
         ELSE 0
    END AS pct
  FROM public.poll_options o
  LEFT JOIN public.poll_votes v ON v.option_id = o.id
  WHERE o.poll_id = p_poll
  GROUP BY o.id, o.title, o.description, o.cover_url, o.external_link, o.sort_order
  ORDER BY o.sort_order, votes DESC;
$$;

GRANT EXECUTE ON FUNCTION public.poll_results TO authenticated, anon;

-- RPC: проголосовать (или поменять голос)
CREATE OR REPLACE FUNCTION public.cast_poll_vote(p_poll bigint, p_option bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- Проверяем что опция принадлежит опросу
  IF NOT EXISTS (SELECT 1 FROM public.poll_options
                 WHERE id = p_option AND poll_id = p_poll) THEN
    RAISE EXCEPTION 'option does not belong to poll';
  END IF;

  -- Проверяем что опрос активен
  IF NOT EXISTS (SELECT 1 FROM public.polls
                 WHERE id = p_poll AND is_active = true
                   AND (ends_at IS NULL OR ends_at > now())) THEN
    RAISE EXCEPTION 'poll is closed';
  END IF;

  INSERT INTO public.poll_votes (poll_id, user_id, option_id)
  VALUES (p_poll, auth.uid(), p_option)
  ON CONFLICT (poll_id, user_id)
  DO UPDATE SET option_id = EXCLUDED.option_id, voted_at = now();
END $$;

GRANT EXECUTE ON FUNCTION public.cast_poll_vote TO authenticated;

-- ---- EARLY ACCESS ----
ALTER TABLE public.chapters
  ADD COLUMN IF NOT EXISTS early_access_until timestamptz;

-- Расширяем can_read_chapter: если early_access_until > now(), то читать могут
-- только подписчики переводчика или купившие главу. После даты — обычная логика.
CREATE OR REPLACE FUNCTION public.can_read_chapter(
  p_user    uuid,
  p_novel   bigint,
  p_chapter int
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_is_paid      boolean;
  v_translator   uuid;
  v_early_until  timestamptz;
BEGIN
  SELECT c.is_paid, n.translator_id, c.early_access_until
  INTO v_is_paid, v_translator, v_early_until
  FROM public.chapters c
  JOIN public.novels   n ON n.id = c.novel_id
  WHERE c.novel_id = p_novel AND c.chapter_number = p_chapter
  LIMIT 1;

  -- Ранний доступ: пока период не истёк, главу видят только подписчики или купившие
  IF v_early_until IS NOT NULL AND v_early_until > now() THEN
    IF EXISTS (
      SELECT 1 FROM public.subscriptions
      WHERE user_id = p_user AND translator_id = v_translator
        AND status = 'active' AND (expires_at IS NULL OR expires_at > now())
    ) THEN RETURN true; END IF;

    IF EXISTS (
      SELECT 1 FROM public.chapter_purchases
      WHERE user_id = p_user AND novel_id = p_novel AND chapter_number = p_chapter
    ) THEN RETURN true; END IF;

    RETURN false;
  END IF;

  -- После истечения ранней фазы: обычная логика для платных глав
  IF NOT v_is_paid THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id       = p_user
      AND translator_id = v_translator
      AND status        = 'active'
      AND (expires_at IS NULL OR expires_at > now())
  ) THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM public.chapter_purchases
    WHERE user_id        = p_user
      AND novel_id       = p_novel
      AND chapter_number = p_chapter
  ) THEN RETURN true; END IF;

  RETURN false;
END $$;
