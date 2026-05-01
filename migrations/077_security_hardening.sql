-- ============================================================
-- 077: Security hardening (RLS, view ownership, bulk_publish UPSERT)
--
-- Что закрываем:
--
--  1. CRITICAL — public.subscriptions без RLS, INSERT открыт authenticated.
--     Любой юзер мог себе вписать INSERT и получить полный paywall-bypass
--     на стороне tene (can_read_chapter читает эту таблицу). То же для
--     public.coin_transactions — там это компрометировало audit-trail.
--
--  2. CRITICAL — bulk_publish_chapters UPSERT затирал is_paid и
--     content_path у уже опубликованных глав. Любой team_member
--     (включая proofreader/beta_reader) мог сделать чужую платную главу
--     бесплатной + подменить путь к файлу.
--
--  3. HIGH — view-ы для marketplace_applications, subscription_claims,
--     translator_payment_methods, team_members, public_profiles, novels
--     создаются с owner=supabase_admin без `security_invoker=on` →
--     RLS базовых таблиц при чтении через view не применяется. Любой
--     authenticated читал ВСЕ строки. В первую очередь критично для
--     subscription_claims_view (Boosty-email/ник всех читателей всем видны)
--     и marketplace_applications_view (приватные сообщения апликантов).
--
--  4. HIGH — apps_self_update policy на marketplace_applications не
--     ограничивает status в WITH CHECK → апликант сам себе ставил
--     status='accepted'.
-- ============================================================

-- ------------------------------------------------------------
-- 1. RLS на subscriptions / coin_transactions
-- ------------------------------------------------------------
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coin_transactions ENABLE ROW LEVEL SECURITY;

-- Закрываем INSERT/UPDATE/DELETE для anon и authenticated.
-- Все записи в эти таблицы должны идти через SECURITY DEFINER RPC
-- (subscription через webhook-handler, coin_transactions через add_coins).
REVOKE INSERT, UPDATE, DELETE ON public.subscriptions     FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.coin_transactions FROM anon, authenticated;

-- Чтение оставляем — это нужно фронту:
--   subscriptions — чтобы tene видел свой статус
--   coin_transactions — чтобы юзер видел историю операций
-- (по идее RLS на чтение тоже должна стоять, но это вне scope этого фикса —
--  policy нужны под конкретную модель отображения, не ломаем имеющееся
--  поведение здесь).

DROP POLICY IF EXISTS subs_self_read ON public.subscriptions;
CREATE POLICY subs_self_read
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id OR auth.uid() = translator_id);

DROP POLICY IF EXISTS subs_admin_all ON public.subscriptions;
CREATE POLICY subs_admin_all
  ON public.subscriptions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.is_admin = true OR p.role = 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.is_admin = true OR p.role = 'admin')
    )
  );

DROP POLICY IF EXISTS coin_tx_self_read ON public.coin_transactions;
CREATE POLICY coin_tx_self_read
  ON public.coin_transactions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS coin_tx_admin_all ON public.coin_transactions;
CREATE POLICY coin_tx_admin_all
  ON public.coin_transactions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.is_admin = true OR p.role = 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.is_admin = true OR p.role = 'admin')
    )
  );

-- ------------------------------------------------------------
-- 2. bulk_publish_chapters: UPSERT не должен трогать is_paid и
-- content_path у существующих глав. Иначе team_member затирает
-- чужую платную главу в free и переподтыкает content_path.
--
-- Вариант: для существующих номеров обновляем ТОЛЬКО published_at
-- (= "опубликовать заранее залитый драфт"). Создание новой платной
-- главы / смена content_path — через отдельную форму, где есть
-- отдельная авторизация на уровне UI.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bulk_publish_chapters(
  p_novel_id          bigint,
  p_chapters          jsonb,
  p_free_range_start  int DEFAULT NULL,
  p_free_range_end    int DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_novel         RECORD;
  v_can           boolean := false;
  v_is_lead       boolean := false;
  v_now           timestamptz := now();
  v_new_count     int := 0;
  v_freed_count   int := 0;
  v_notified      int := 0;
  v_chap          jsonb;
  v_new_nums      int[] := '{}';
  v_freed_nums    int[] := '{}';
  v_msg           text;
  v_url           text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT n.id, n.firebase_id, n.title, n.translator_id, n.team_id
  INTO v_novel
  FROM public.novels n WHERE n.id = p_novel_id;
  IF v_novel.id IS NULL THEN
    RAISE EXCEPTION 'novel not found';
  END IF;

  -- translator_id или admin — полный доступ. team_member 'lead' — тоже.
  -- Прочие team-роли (co_translator, proofreader, beta_reader, other)
  -- bulk-публиковать не могут: иначе любой "помощник" затирает чужие
  -- главы после ON CONFLICT.
  IF v_novel.translator_id = v_uid THEN
    v_can := true;
    v_is_lead := true;
  ELSIF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_uid AND (is_admin = true OR role = 'admin')
  ) THEN
    v_can := true;
    v_is_lead := true;
  ELSIF v_novel.team_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.team_members
    WHERE team_id = v_novel.team_id AND user_id = v_uid AND role = 'lead'
  ) THEN
    v_can := true;
    v_is_lead := true;
  END IF;
  IF NOT v_can THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  PERFORM set_config('app.skip_chapter_notify', 'on', true);

  IF p_chapters IS NOT NULL AND jsonb_array_length(p_chapters) > 0 THEN
    FOR v_chap IN SELECT * FROM jsonb_array_elements(p_chapters)
    LOOP
      -- INSERT-only: если глава уже существует, обновляем ТОЛЬКО
      -- published_at (чтобы триггеры подхватили "опубликована").
      -- is_paid и content_path трогаем только при создании новой строки.
      INSERT INTO public.chapters
        (novel_id, chapter_number, content_path, is_paid, published_at)
      VALUES (
        p_novel_id,
        (v_chap->>'num')::int,
        v_chap->>'content_path',
        COALESCE((v_chap->>'is_paid')::boolean, false),
        v_now
      )
      ON CONFLICT (novel_id, chapter_number) DO UPDATE SET
        published_at = EXCLUDED.published_at
      WHERE public.chapters.published_at IS NULL;
      v_new_count := v_new_count + 1;
      v_new_nums  := v_new_nums || (v_chap->>'num')::int;
    END LOOP;
  END IF;

  IF p_free_range_start IS NOT NULL
     AND p_free_range_end IS NOT NULL
     AND p_free_range_start <= p_free_range_end THEN
    WITH freed AS (
      UPDATE public.chapters
      SET is_paid = false,
          published_at = v_now
      WHERE novel_id = p_novel_id
        AND chapter_number BETWEEN p_free_range_start AND p_free_range_end
        AND is_paid = true
      RETURNING chapter_number
    )
    SELECT array_agg(chapter_number ORDER BY chapter_number),
           count(*)::int
    INTO v_freed_nums, v_freed_count
    FROM freed;
    v_freed_nums := COALESCE(v_freed_nums, '{}'::int[]);
  END IF;

  IF v_new_count > 0 OR v_freed_count > 0 THEN
    UPDATE public.novels SET latest_chapter_published_at = v_now WHERE id = p_novel_id;
  END IF;

  IF v_new_count > 0 OR v_freed_count > 0 THEN
    v_msg := '«' || v_novel.title || '»: ';
    IF v_new_count > 0 THEN
      v_msg := v_msg || 'новые главы ' || array_to_string(v_new_nums, ', ');
    END IF;
    IF v_freed_count > 0 THEN
      IF v_new_count > 0 THEN v_msg := v_msg || ' · '; END IF;
      v_msg := v_msg || 'открыты бесплатно ' || array_to_string(v_freed_nums, ', ');
    END IF;

    v_url := CASE
      WHEN v_new_count > 0 THEN
        '/novel/' || v_novel.firebase_id || '/' || v_new_nums[1]
      WHEN v_freed_count > 0 THEN
        '/novel/' || v_novel.firebase_id || '/' || v_freed_nums[1]
      ELSE
        '/novel/' || v_novel.firebase_id
    END;

    INSERT INTO public.notifications
      (user_id, type, text, target_url, actor_id, group_key, ref_novel_id)
    SELECT
      u.user_id,
      'new_chapter',
      v_msg,
      v_url,
      v_novel.translator_id,
      'bulk_publish:' || v_novel.id || ':' || to_char(v_now, 'YYYY-MM-DD-HH24-MI'),
      v_novel.id
    FROM (
      SELECT s.user_id
      FROM public.chaptify_subscriptions s
      WHERE s.translator_id = v_novel.translator_id
        AND s.status = 'active'
        AND (s.expires_at IS NULL OR s.expires_at > now())
      UNION
      SELECT p.id AS user_id
      FROM public.profiles p
      WHERE p.bookmarks ? v_novel.firebase_id
    ) u
    WHERE u.user_id IS NOT NULL
      AND u.user_id <> v_novel.translator_id;
    GET DIAGNOSTICS v_notified = ROW_COUNT;
  END IF;

  PERFORM set_config('app.skip_chapter_notify', 'off', true);

  RETURN jsonb_build_object(
    'ok',              true,
    'new_count',       v_new_count,
    'freed_count',     v_freed_count,
    'notified_users',  v_notified,
    'new_numbers',     v_new_nums,
    'freed_numbers',   v_freed_nums
  );
END $$;

GRANT EXECUTE ON FUNCTION public.bulk_publish_chapters(bigint, jsonb, int, int)
  TO authenticated;

-- ------------------------------------------------------------
-- 3. security_invoker=on на критичных view'ах.
-- Без этого view игнорирует RLS базовой таблицы при чтении,
-- т.к. owner=supabase_admin и view запускается с правами owner'а.
-- DO $$ ... $$ — чтобы не падать, если view-а в этой инсталляции нет.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_view text;
BEGIN
  FOREACH v_view IN ARRAY ARRAY[
    'marketplace_applications_view',
    'marketplace_listings_view',
    'subscription_claims_view',
    'translator_payment_methods_view',
    'team_view',
    'team_members_view',
    'public_profiles',
    'novels_view',
    'novel_credits'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = v_view
    ) THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = on)', v_view);
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 4. apps_self_update — апликант не должен сам себе ставить status='accepted'.
-- Разрешаем только pending → withdrawn и редактирование message.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS apps_self_update ON public.marketplace_applications;
CREATE POLICY apps_self_update
  ON public.marketplace_applications FOR UPDATE
  USING (auth.uid() = applicant_id)
  WITH CHECK (
    auth.uid() = applicant_id
    AND status IN ('pending', 'withdrawn')
  );
