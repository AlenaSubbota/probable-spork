-- ============================================================
-- 066: пользовательские жалобы на контент
--
-- В справке и правилах сообщества упоминается «⚠ Пожаловаться» на
-- комментарий, новеллу и цитату — но самой кнопки и таблицы
-- никогда не было. Добавляем минимальный поток:
--   1) read-only-таблица user_complaints;
--   2) RPC submit_complaint() — записывает жалобу с проверками;
--   3) защита от спама: rate-limit, дубликаты;
--   4) READ — только админ.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_complaints (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  target_type     text   NOT NULL
    CHECK (target_type IN ('comment', 'novel', 'quote')),
  -- target_id хранится как text, потому что у нас разные типы PK:
  -- comments.id (bigint), novels.id (bigint), quotes.id (uuid) —
  -- общим типом для удобства держим строку.
  target_id       text   NOT NULL,
  reporter_id     uuid   NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason          text   NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- Поля для модератора (заполняются через админ-флоу, который
  -- придёт следующим шагом). Пока просто NULL по умолчанию.
  reviewed_at     timestamptz,
  reviewer_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution      text
    CHECK (resolution IS NULL OR resolution IN ('upheld', 'rejected', 'duplicate'))
);

-- Один пользователь может подать только одну активную (не разрешённую)
-- жалобу на конкретный объект. Повторно — уже после resolution.
CREATE UNIQUE INDEX IF NOT EXISTS uc_unique_open
  ON public.user_complaints (reporter_id, target_type, target_id)
  WHERE resolution IS NULL;

CREATE INDEX IF NOT EXISTS idx_uc_target
  ON public.user_complaints (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_uc_pending
  ON public.user_complaints (created_at DESC)
  WHERE resolution IS NULL;

ALTER TABLE public.user_complaints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS uc_self_select  ON public.user_complaints;
DROP POLICY IF EXISTS uc_admin_all    ON public.user_complaints;

-- Заявитель видит только свои жалобы (чтобы не было «утечки» того,
-- кто на кого подал).
CREATE POLICY uc_self_select
  ON public.user_complaints FOR SELECT
  USING (auth.uid() = reporter_id);

-- Админ — всё.
CREATE POLICY uc_admin_all
  ON public.user_complaints FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (role = 'admin' OR COALESCE(is_admin, false) = true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND (role = 'admin' OR COALESCE(is_admin, false) = true)
    )
  );

GRANT SELECT ON public.user_complaints TO authenticated;

-- ------------------------------------------------------------
-- RPC submit_complaint: единая точка входа для UI.
-- Делает все проверки в одной транзакции:
--   • валидация target_type/target_id;
--   • существование цели (комментарий, новелла, цитата);
--   • rate-limit: не более 10 жалоб от одного юзера за час;
--   • дедуп через unique index (UPSERT при коллизии — обновим reason).
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_complaint(
  p_target_type text,
  p_target_id   text,
  p_reason      text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_clean       text := btrim(COALESCE(p_reason, ''));
  v_recent_cnt  int;
  v_id          bigint;
  v_target_ok   boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
  END IF;

  IF p_target_type NOT IN ('comment', 'novel', 'quote') THEN
    RAISE EXCEPTION 'unknown target_type %', p_target_type
      USING ERRCODE = '22023';
  END IF;

  IF char_length(v_clean) < 1 OR char_length(v_clean) > 1000 THEN
    RAISE EXCEPTION 'reason must be 1..1000 chars'
      USING ERRCODE = '22023';
  END IF;

  IF p_target_id IS NULL OR btrim(p_target_id) = '' THEN
    RAISE EXCEPTION 'target_id required' USING ERRCODE = '22023';
  END IF;

  -- Проверка, что цель существует. Жалоба «в никуда» неинтересна.
  IF p_target_type = 'comment' THEN
    SELECT EXISTS(
      SELECT 1 FROM public.comments WHERE id = p_target_id::bigint
    ) INTO v_target_ok;
  ELSIF p_target_type = 'novel' THEN
    SELECT EXISTS(
      SELECT 1 FROM public.novels WHERE id = p_target_id::bigint
    ) INTO v_target_ok;
  ELSE  -- quote
    -- Таблица user_quotes из миграции 014. Если её ещё нет — пропустим.
    BEGIN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.user_quotes WHERE id::text = $1)'
        INTO v_target_ok USING p_target_id;
    EXCEPTION WHEN undefined_table THEN
      v_target_ok := true;  -- таблицы нет — не блокируем жалобу
    END;
  END IF;

  IF NOT COALESCE(v_target_ok, false) THEN
    RAISE EXCEPTION 'target % not found', p_target_id
      USING ERRCODE = '22023';
  END IF;

  -- Rate-limit: не больше 10 жалоб в час от одного юзера.
  SELECT COUNT(*) INTO v_recent_cnt
  FROM public.user_complaints
  WHERE reporter_id = v_user
    AND created_at > now() - interval '1 hour';

  IF v_recent_cnt >= 10 THEN
    RAISE EXCEPTION 'too many complaints, try later'
      USING ERRCODE = '22023';
  END IF;

  -- Главный INSERT. На дубликат — обновляем reason (юзер мог
  -- передумать формулировку для той же цели).
  INSERT INTO public.user_complaints
    (target_type, target_id, reporter_id, reason)
  VALUES
    (p_target_type, p_target_id, v_user, v_clean)
  ON CONFLICT (reporter_id, target_type, target_id) WHERE resolution IS NULL
  DO UPDATE SET reason = EXCLUDED.reason
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.submit_complaint(text, text, text) TO authenticated;

-- Краткая сводка по жалобам для админ-панели — сколько pending по типу.
CREATE OR REPLACE FUNCTION public.complaint_pending_counts()
RETURNS TABLE (target_type text, pending int)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT
    target_type,
    COUNT(*)::int AS pending
  FROM public.user_complaints
  WHERE resolution IS NULL
  GROUP BY target_type;
$$;

GRANT EXECUTE ON FUNCTION public.complaint_pending_counts() TO authenticated;
