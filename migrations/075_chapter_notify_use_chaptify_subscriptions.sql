-- ============================================================
-- 075: trg_notify_new_chapter и bulk_publish_chapters
--      переезжают на chaptify_subscriptions
--
-- Проблема: оба места, где мы выбираем «кому слать уведомление
-- о новой главе», джойнили мёртвую таблицу public.subscriptions.
-- Каноном с миграции 053 является public.chaptify_subscriptions —
-- сайт читает и пишет только её (см. также серверный коммит
-- c3ab77a, который выкинул fallback на subscriptions из бота).
-- В итоге активные подписчики Chaptify не попадали в выборку,
-- уведомления в notifications падали только за счёт ветки
-- profiles.bookmarks ?, плюс автор фильтровался WHERE-ом, и
-- chaptify-bot оставался безмолвным.
--
-- Исправляем обе функции: тот же UNION, только источник
-- подписчиков теперь chaptify_subscriptions. Схема идентична
-- (user_id, translator_id, status, expires_at), остальной код
-- не трогаем.
-- ============================================================

CREATE OR REPLACE FUNCTION public.trg_notify_new_chapter()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_novel        RECORD;
  v_was_live     boolean;
  v_now_live     boolean;
  v_was_free     boolean;
  v_now_free     boolean;
  v_just_freed   boolean;
  v_just_live    boolean;
BEGIN
  IF current_setting('app.skip_chapter_notify', true) = 'on' THEN
    RETURN NEW;
  END IF;

  v_now_live := NEW.published_at IS NOT NULL AND NEW.published_at <= now();
  v_now_free := NOT COALESCE(NEW.is_paid, false);

  IF TG_OP = 'INSERT' THEN
    v_was_live := false;
    v_was_free := true;
  ELSE
    v_was_live := OLD.published_at IS NOT NULL AND OLD.published_at <= now();
    v_was_free := NOT COALESCE(OLD.is_paid, false);
  END IF;

  v_just_live  := v_now_live AND NOT v_was_live;
  v_just_freed := v_now_live AND v_was_live AND NOT v_was_free AND v_now_free;

  IF NOT (v_just_live OR v_just_freed) THEN
    RETURN NEW;
  END IF;

  SELECT id, firebase_id, title, translator_id
  INTO v_novel
  FROM public.novels WHERE id = NEW.novel_id;

  IF v_novel.id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.notifications
    (user_id, type, text, target_url, actor_id, group_key, ref_novel_id)
  SELECT
    u.user_id,
    'new_chapter',
    CASE
      WHEN v_just_freed THEN
        'Глава ' || NEW.chapter_number || ' «' || v_novel.title || '» теперь бесплатна'
      ELSE
        'Новая глава «' || v_novel.title || '» · глава ' || NEW.chapter_number
    END,
    '/novel/' || v_novel.firebase_id || '/' || NEW.chapter_number,
    v_novel.translator_id,
    'new_chapter:' || v_novel.id,
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

  RETURN NEW;
END $$;


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

  IF v_novel.translator_id = v_uid THEN
    v_can := true;
  ELSIF v_novel.team_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.team_members
    WHERE team_id = v_novel.team_id AND user_id = v_uid
  ) THEN
    v_can := true;
  ELSIF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_uid AND (is_admin = true OR role = 'admin')
  ) THEN
    v_can := true;
  END IF;
  IF NOT v_can THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  PERFORM set_config('app.skip_chapter_notify', 'on', true);

  IF p_chapters IS NOT NULL AND jsonb_array_length(p_chapters) > 0 THEN
    FOR v_chap IN SELECT * FROM jsonb_array_elements(p_chapters)
    LOOP
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
        content_path = EXCLUDED.content_path,
        is_paid      = EXCLUDED.is_paid,
        published_at = EXCLUDED.published_at;
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
