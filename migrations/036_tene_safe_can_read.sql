-- ============================================================
-- 036: tene-safe откат can_read_chapter + chaptify-специфичная версия
--
-- В миграции 034 мы переписали public.can_read_chapter так, что он
-- автоматически пропускает автора новеллы и членов команды. Это
-- изменило поведение для tene, где логика этого RPC была другой.
--
-- Откатываем общий can_read_chapter к версии из 013 (без chaptify-
-- специфики), и выносим нашу логику в отдельную функцию
-- can_read_chapter_chaptify. Клиент chaptify использует её.
--
-- Заодно смягчаем comments_self_insert policy (если tene пишет
-- комменты с user_id=NULL — legacy анон — мы не ломаем им это).
-- ============================================================

-- ---- Восстанавливаем общий can_read_chapter к версии 013 ----
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

  -- Обычная логика для платных глав
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

GRANT EXECUTE ON FUNCTION public.can_read_chapter(uuid, bigint, int) TO authenticated, anon;

-- ---- chaptify-специфичная версия ----
-- Пропускает автора новеллы (translator_id), всех членов команды из
-- novel_translators и админов. Иначе — та же логика что и у общего.
CREATE OR REPLACE FUNCTION public.can_read_chapter_chaptify(
  p_user    uuid,
  p_novel   bigint,
  p_chapter int
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_is_paid      boolean;
  v_translator   uuid;
  v_early_until  timestamptz;
  v_is_team      boolean := false;
  v_is_admin     boolean := false;
BEGIN
  SELECT c.is_paid, n.translator_id, c.early_access_until
  INTO v_is_paid, v_translator, v_early_until
  FROM public.chapters c
  JOIN public.novels   n ON n.id = c.novel_id
  WHERE c.novel_id = p_novel AND c.chapter_number = p_chapter
  LIMIT 1;

  IF p_user IS NOT NULL THEN
    IF p_user = v_translator THEN
      v_is_team := true;
    ELSE
      -- novel_translators есть только после миграции 034
      BEGIN
        SELECT EXISTS (
          SELECT 1 FROM public.novel_translators
          WHERE novel_id = p_novel AND user_id = p_user
        ) INTO v_is_team;
      EXCEPTION WHEN undefined_table THEN
        v_is_team := false;
      END;
    END IF;

    SELECT (is_admin = true OR role = 'admin')
    INTO v_is_admin
    FROM public.profiles WHERE id = p_user;
  END IF;

  IF v_is_team OR v_is_admin THEN RETURN true; END IF;

  -- Дальше — как в общем can_read_chapter (ранний доступ / подписка / покупка)
  RETURN public.can_read_chapter(p_user, p_novel, p_chapter);
END $$;

GRANT EXECUTE ON FUNCTION public.can_read_chapter_chaptify(uuid, bigint, int) TO authenticated, anon;

-- ---- Смягчение comments_self_insert — учитываем legacy анон-комменты ----
--
-- В миграции 029 политика требовала auth.uid() = user_id. Если на tene
-- были (или есть) записи с user_id=NULL — у их авторов INSERT через
-- клиент не проходит. Смягчаем: разрешаем либо «я и есть автор» либо
-- «user_id NULL» (чистый анон).
DROP POLICY IF EXISTS comments_self_insert ON public.comments;
CREATE POLICY comments_self_insert
  ON public.comments FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    OR user_id IS NULL
  );
