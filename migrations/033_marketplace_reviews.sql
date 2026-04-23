-- ============================================================
-- 033: маркетплейс — отзывы, рейтинги, уведомления
--
-- Надстройка поверх 032. Не трогаем существующие таблицы listings/
-- applications — только добавляем.
-- ============================================================

-- ------------------------------------------------------------
-- Отзывы
--
-- Отзыв — только на закрытых листингах (status = 'closed'). Оставлять
-- могут только участники: автор листинга (про одного из accepted applicants)
-- и принятые applicants (про автора листинга). RLS описываю ниже как
-- политики вместо RPC — проще и прозрачнее.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketplace_reviews (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  listing_id  bigint NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  author_id   uuid   NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subject_id  uuid   NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating      int    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text        text   CHECK (text IS NULL OR length(text) <= 800),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, author_id, subject_id),
  CONSTRAINT reviews_not_self CHECK (author_id <> subject_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_subject
  ON public.marketplace_reviews (subject_id, created_at DESC);

ALTER TABLE public.marketplace_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reviews_read_all    ON public.marketplace_reviews;
DROP POLICY IF EXISTS reviews_insert_participant ON public.marketplace_reviews;
DROP POLICY IF EXISTS reviews_self_update ON public.marketplace_reviews;
DROP POLICY IF EXISTS reviews_admin_all   ON public.marketplace_reviews;

CREATE POLICY reviews_read_all
  ON public.marketplace_reviews FOR SELECT
  USING (true);

-- INSERT: только если пишу как участник закрытого листинга.
-- Два сценария:
--  A) Я автор листинга → subject — один из accepted applicants
--  B) Я accepted applicant → subject — автор листинга
CREATE POLICY reviews_insert_participant
  ON public.marketplace_reviews FOR INSERT
  WITH CHECK (
    auth.uid() = author_id
    AND EXISTS (
      SELECT 1 FROM public.marketplace_listings l
      WHERE l.id = listing_id
        AND l.status = 'closed'
        AND (
          -- (A) я автор листинга, subject должен быть accepted applicant
          (l.author_id = auth.uid() AND EXISTS (
            SELECT 1 FROM public.marketplace_applications a
            WHERE a.listing_id = l.id
              AND a.applicant_id = subject_id
              AND a.status = 'accepted'
          ))
          OR
          -- (B) я accepted applicant, subject — автор листинга
          (l.author_id = subject_id AND EXISTS (
            SELECT 1 FROM public.marketplace_applications a
            WHERE a.listing_id = l.id
              AND a.applicant_id = auth.uid()
              AND a.status = 'accepted'
          ))
        )
    )
  );

-- Автор может править свой отзыв
CREATE POLICY reviews_self_update
  ON public.marketplace_reviews FOR UPDATE
  USING (auth.uid() = author_id)
  WITH CHECK (auth.uid() = author_id);

-- Админ — всё (в т.ч. удаление оскорбительных)
CREATE POLICY reviews_admin_all
  ON public.marketplace_reviews FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = true OR role = 'admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = true OR role = 'admin')
  ));

GRANT SELECT                         ON public.marketplace_reviews TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketplace_reviews TO authenticated;

-- ------------------------------------------------------------
-- View: агрегированный рейтинг по пользователю
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.marketplace_ratings AS
SELECT
  subject_id                             AS user_id,
  COUNT(*)::int                          AS reviews_count,
  ROUND(AVG(rating)::numeric, 1)         AS avg_rating,
  MAX(created_at)                        AS last_review_at
FROM public.marketplace_reviews
GROUP BY subject_id;

ALTER VIEW public.marketplace_ratings OWNER TO supabase_admin;
GRANT SELECT ON public.marketplace_ratings TO anon, authenticated;

-- View с данными автора отзыва — для рендера секции на профиле
CREATE OR REPLACE VIEW public.marketplace_reviews_view AS
SELECT
  r.id,
  r.listing_id,
  r.author_id,
  r.subject_id,
  r.rating,
  r.text,
  r.created_at,
  p.user_name         AS author_name,
  p.avatar_url        AS author_avatar,
  p.translator_slug   AS author_slug,
  l.title             AS listing_title,
  l.role              AS listing_role
FROM public.marketplace_reviews r
LEFT JOIN public.profiles                p ON p.id = r.author_id
LEFT JOIN public.marketplace_listings    l ON l.id = r.listing_id;

ALTER VIEW public.marketplace_reviews_view OWNER TO supabase_admin;
GRANT SELECT ON public.marketplace_reviews_view TO anon, authenticated;

-- ------------------------------------------------------------
-- Триггер: уведомление автору листинга при новом отклике
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_notify_marketplace_application()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_author_id   uuid;
  v_listing_t   text;
  v_applicant_n text;
BEGIN
  SELECT author_id, title INTO v_author_id, v_listing_t
  FROM public.marketplace_listings WHERE id = NEW.listing_id;

  IF v_author_id IS NULL OR v_author_id = NEW.applicant_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(user_name, 'Читатель')
  INTO v_applicant_n
  FROM public.profiles WHERE id = NEW.applicant_id;

  INSERT INTO public.notifications
    (user_id, type, text, target_url, actor_id, group_key)
  VALUES
    (v_author_id,
     'marketplace_application',
     v_applicant_n || ' откликнулся_а на «' || COALESCE(v_listing_t, 'объявление') || '»',
     '/market/' || NEW.listing_id,
     NEW.applicant_id,
     'marketplace:' || NEW.listing_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_marketplace_application ON public.marketplace_applications;
CREATE TRIGGER on_marketplace_application
  AFTER INSERT ON public.marketplace_applications
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_marketplace_application();

-- ------------------------------------------------------------
-- Триггер: уведомление applicant'у когда автор меняет статус отклика
-- (accepted / declined) — чтобы не пришлось обновлять страницу.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_notify_application_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_listing_t text;
  v_verb      text;
BEGIN
  -- Только осмысленные переходы, инициированные автором листинга
  IF NEW.status NOT IN ('accepted', 'declined') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT title INTO v_listing_t
  FROM public.marketplace_listings WHERE id = NEW.listing_id;

  v_verb := CASE NEW.status WHEN 'accepted' THEN 'принят_а' ELSE 'отклонён_а' END;

  INSERT INTO public.notifications
    (user_id, type, text, target_url, group_key)
  VALUES
    (NEW.applicant_id,
     'marketplace_status',
     'Отклик ' || v_verb || ' на «' || COALESCE(v_listing_t, 'объявление') || '»',
     '/market/' || NEW.listing_id,
     'marketplace-status:' || NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_marketplace_app_status ON public.marketplace_applications;
CREATE TRIGGER on_marketplace_app_status
  AFTER UPDATE OF status ON public.marketplace_applications
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_application_status();
