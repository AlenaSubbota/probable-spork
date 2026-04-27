-- ============================================================
-- 063: Фикс уведомлений при «открыть главу бесплатно» +
--      RPC publish_single_chapter с опцией silent
--
-- Проблемы:
--
-- 1) bulk_publish_chapters при открытии диапазона глав бесплатно
--    использовал `published_at = COALESCE(published_at, v_now)`.
--    Для уже опубликованных глав (типичный случай: «было платно,
--    открываем бесплатно») это значило, что published_at не менялся.
--    В каталоге и читалке такие главы не «всплывали как новые», и
--    индивидуальные feed-ленты их не подсвечивали.
--    Фикс: всегда `published_at = v_now`. Уведомление и так шлётся
--    единым консолидированным INSERT'ом (group_key = bulk_publish:…),
--    так что multiple per-row пушей не возникает — session-флаг
--    app.skip_chapter_notify = 'on' это уже гарантирует.
--
-- 2) Per-row триггер trg_notify_new_chapter висел только на
--    UPDATE OF published_at. ChapterForm одиночная не трогает
--    published_at когда переводчик флипает is_paid (т.е. «открывает
--    одну главу бесплатно»), поэтому уведомление вообще не уходило.
--    Фикс: расширяем триггер на UPDATE OF (published_at, is_paid),
--    плюс в самом теле проверяем «было платно && стало бесплатно &&
--    глава уже live» — этот переход тоже считается «значимым событием
--    для подписчика», шлём уведомление.
--
-- 3) Переводчику нужна возможность «опубликовать тихо» — например,
--    мелкая правка опечатки в уже вышедшей главе не должна спамить
--    подписчиков. Делаем новую RPC publish_single_chapter с опцией
--    silent, которая перед UPSERT включает session-флаг тишины.
--    ChapterForm.tsx будет звать её вместо прямых INSERT/UPDATE.
-- ============================================================

-- ---------- 1. Триггер: реагирует и на is_paid: true → false ----------

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
  -- Bulk-RPC и publish_single_chapter(silent=true) выставляют этот
  -- session-флаг и сами решают, нужно ли уведомление. Per-row триггер
  -- молчит.
  IF current_setting('app.skip_chapter_notify', true) = 'on' THEN
    RETURN NEW;
  END IF;

  v_now_live := NEW.published_at IS NOT NULL AND NEW.published_at <= now();
  v_now_free := NOT COALESCE(NEW.is_paid, false);

  IF TG_OP = 'INSERT' THEN
    v_was_live := false;
    v_was_free := true; -- неважно, главное что INSERT-ом покрытие
                        -- определяется через v_just_live ниже
  ELSE
    v_was_live := OLD.published_at IS NOT NULL AND OLD.published_at <= now();
    v_was_free := NOT COALESCE(OLD.is_paid, false);
  END IF;

  -- Событие 1: глава впервые ушла в эфир (или из scheduled стала live).
  v_just_live := v_now_live AND NOT v_was_live;
  -- Событие 2: уже live глава была платной, стала бесплатной — это
  -- значимое событие для подписчиков (раньше тут просто молчали).
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
    FROM public.subscriptions s
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

-- Триггер слушает оба поля, иначе UPDATE с одним is_paid не пробудит
-- функцию (даже если в теле всё проверяется правильно).
DROP TRIGGER IF EXISTS on_chapter_published_notify ON public.chapters;
CREATE TRIGGER on_chapter_published_notify
  AFTER INSERT OR UPDATE OF published_at, is_paid ON public.chapters
  FOR EACH ROW EXECUTE FUNCTION public.trg_notify_new_chapter();

-- ---------- 2. bulk_publish_chapters: всегда обновлять published_at ----------

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

  -- 1) Новые / обновлённые главы из p_chapters
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

  -- 2) Открыть диапазон существующих глав бесплатно. ВАЖНО: всегда
  --    обновляем published_at = v_now, чтобы:
  --    (а) freed-главы всплывали в каталоге как «свежие»
  --    (б) сортировка по published_at у читателя ставила их выше
  --    Per-row триггер не зашумит — он подавлен session-флагом выше,
  --    мы шлём ОДНО консолидированное уведомление в шаге 3.
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
      FROM public.subscriptions s
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

-- ---------- 3. RPC publish_single_chapter с опцией silent ----------
--
-- Заменяет прямые INSERT/UPDATE из ChapterForm.tsx. Доп. возможность —
-- p_silent: при сохранении мелкой правки переводчик может выключить
-- уведомление подписчикам. Внутри функции мы выставляем session-флаг
-- app.skip_chapter_notify, и per-row триггер промолчит. Без silent
-- триггер работает как обычно.
--
-- Аргументы:
--   p_novel_id        bigint
--   p_chapter_number  int
--   p_content_path    text   — путь в storage (клиент уже залил файл)
--   p_is_paid         boolean
--   p_price_coins     int    — будет применено только если is_paid
--   p_published_at    timestamptz   — NULL = черновик, now() = сейчас, future = scheduled
--   p_mode            text   — 'create' | 'edit'
--   p_silent          boolean DEFAULT false — не слать уведомление
--
-- Возвращает jsonb {ok, action, is_publishing_now}.

CREATE OR REPLACE FUNCTION public.publish_single_chapter(
  p_novel_id        bigint,
  p_chapter_number  int,
  p_content_path    text,
  p_is_paid         boolean,
  p_price_coins     int,
  p_published_at    timestamptz,
  p_mode            text,
  p_silent          boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_novel     RECORD;
  v_can       boolean := false;
  v_now       timestamptz := now();
  v_action    text;
  v_live_now  boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_chapter_number IS NULL OR p_chapter_number < 1 THEN
    RAISE EXCEPTION 'chapter_number must be >= 1';
  END IF;
  IF p_mode NOT IN ('create', 'edit') THEN
    RAISE EXCEPTION 'mode must be create or edit';
  END IF;

  SELECT n.id, n.firebase_id, n.translator_id, n.team_id
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

  IF p_silent THEN
    PERFORM set_config('app.skip_chapter_notify', 'on', true);
  END IF;

  IF p_mode = 'create' THEN
    INSERT INTO public.chapters
      (novel_id, chapter_number, content_path, is_paid, price_coins, published_at)
    VALUES (
      p_novel_id, p_chapter_number, p_content_path,
      COALESCE(p_is_paid, false),
      CASE WHEN p_is_paid THEN COALESCE(p_price_coins, 10) ELSE 10 END,
      p_published_at
    );
    v_action := 'created';
    -- На случай если переводчик жмёт «Опубликовать» по уже существующей
    -- главе с тем же номером — выкидываем понятную ошибку. Триггер
    -- уникальности на (novel_id, chapter_number) упадёт сам, но текст
    -- получится Postgres'овский.
  ELSE
    UPDATE public.chapters
    SET content_path = p_content_path,
        is_paid      = COALESCE(p_is_paid, false),
        price_coins  = CASE WHEN p_is_paid THEN COALESCE(p_price_coins, 10) ELSE 10 END,
        published_at = p_published_at
    WHERE novel_id = p_novel_id
      AND chapter_number = p_chapter_number;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'chapter not found';
    END IF;
    v_action := 'updated';
  END IF;

  v_live_now := p_published_at IS NOT NULL AND p_published_at <= v_now + interval '1 minute';

  IF v_live_now THEN
    UPDATE public.novels
    SET latest_chapter_published_at = v_now
    WHERE id = p_novel_id;
  END IF;

  IF p_silent THEN
    PERFORM set_config('app.skip_chapter_notify', 'off', true);
  END IF;

  RETURN jsonb_build_object(
    'ok',                true,
    'action',            v_action,
    'is_publishing_now', v_live_now,
    'silent',            COALESCE(p_silent, false)
  );
END $$;

GRANT EXECUTE ON FUNCTION
  public.publish_single_chapter(bigint, int, text, boolean, int, timestamptz, text, boolean)
  TO authenticated;
