-- ============================================================
-- Миграция 011: учёт выплат переводчикам
-- Каждый период (обычно месяц) админ закрывает: смотрит сколько
-- причитается каждому переводчику, переводит деньги, помечает как
-- «выплачено». После этого эти coin_transactions входят в закрытый
-- цикл и больше не учитываются в «К выплате».
-- Зависит от 001 (coin_transactions, chapter_purchases, translator_id).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.payout_cycles (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  translator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period_from   timestamptz NOT NULL,
  period_to     timestamptz NOT NULL,
  coins_gross   integer NOT NULL,       -- сколько монет заработано в периоде
  platform_fee_pct numeric(5,2) NOT NULL DEFAULT 0,
  coins_net     integer NOT NULL,       -- после комиссии = coins_gross × (1 - fee/100)
  rub_rate      numeric(6,2) NOT NULL DEFAULT 1.00,  -- сколько ₽ за монету на момент выплаты
  amount_rub    numeric(10,2) NOT NULL,
  payout_method text,                   -- 'tribute' | 'boosty' | 'sbp' | 'card' | 'other'
  payout_ref    text,                   -- номер транзакции, ссылка на подтверждение
  note          text,
  paid_at       timestamptz,            -- NULL = ещё не выплачено
  created_at    timestamptz DEFAULT now(),
  created_by    uuid REFERENCES public.profiles(id),
  CONSTRAINT period_valid CHECK (period_to > period_from)
);

CREATE INDEX IF NOT EXISTS idx_payout_cycles_translator_period
  ON public.payout_cycles (translator_id, period_to DESC);

ALTER TABLE public.payout_cycles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payout_cycles_self       ON public.payout_cycles;
DROP POLICY IF EXISTS payout_cycles_admin_all  ON public.payout_cycles;

-- Переводчик видит только свои
CREATE POLICY payout_cycles_self
  ON public.payout_cycles FOR SELECT
  USING (auth.uid() = translator_id);

-- Админ управляет всеми
CREATE POLICY payout_cycles_admin_all
  ON public.payout_cycles FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
              AND (is_admin = true OR role = 'admin'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles
            WHERE id = auth.uid()
              AND (is_admin = true OR role = 'admin'))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payout_cycles TO authenticated;

-- ============================================================
-- RPC: сколько монет причитается переводчику между датами
-- (без учёта уже закрытых циклов)
-- ============================================================
CREATE OR REPLACE FUNCTION public.translator_earnings_raw(
  p_translator uuid,
  p_from       timestamptz,
  p_to         timestamptz
) RETURNS TABLE (
  coins_gross   bigint,
  chapter_count bigint,
  unique_buyers bigint
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH my_novel_ids AS (
    SELECT id FROM public.novels WHERE translator_id = p_translator
  ),
  purchases AS (
    SELECT ct.user_id, ct.amount
    FROM public.coin_transactions ct
    WHERE ct.reason = 'chapter_purchase'
      AND ct.created_at >= p_from
      AND ct.created_at < p_to
      AND (split_part(ct.reference_id, ':', 1))::bigint IN (SELECT id FROM my_novel_ids)
  )
  SELECT
    COALESCE(SUM(ABS(amount))::bigint, 0)      AS coins_gross,
    COUNT(*)::bigint                           AS chapter_count,
    COUNT(DISTINCT user_id)::bigint            AS unique_buyers
  FROM purchases;
$$;

GRANT EXECUTE ON FUNCTION public.translator_earnings_raw TO authenticated;

-- ============================================================
-- RPC: «к выплате» для одного переводчика на сейчас
-- (всё с прошлой выплаты и до now() минус уже закрытые циклы)
-- ============================================================
CREATE OR REPLACE FUNCTION public.translator_earnings_pending(p_translator uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_since timestamptz;
  v_raw   record;
BEGIN
  -- С какой даты считаем: либо с конца последнего закрытого цикла,
  -- либо с эпохи (2020), если циклов ещё не было.
  SELECT COALESCE(MAX(period_to), '2020-01-01'::timestamptz)
  INTO v_since
  FROM public.payout_cycles
  WHERE translator_id = p_translator;

  SELECT *
  INTO v_raw
  FROM public.translator_earnings_raw(p_translator, v_since, now());

  RETURN jsonb_build_object(
    'since',         v_since,
    'coins_gross',   v_raw.coins_gross,
    'chapter_count', v_raw.chapter_count,
    'unique_buyers', v_raw.unique_buyers
  );
END $$;

GRANT EXECUTE ON FUNCTION public.translator_earnings_pending TO authenticated;

-- ============================================================
-- RPC: сводка по всем переводчикам за период (для админа)
-- ============================================================
CREATE OR REPLACE FUNCTION public.all_translators_earnings(
  p_from timestamptz,
  p_to   timestamptz
) RETURNS TABLE (
  translator_id     uuid,
  translator_name   text,
  translator_slug   text,
  coins_gross       bigint,
  chapter_count     bigint,
  unique_buyers     bigint,
  payout_method     text,
  payout_ref        text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND (is_admin = true OR role = 'admin')
  ) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  RETURN QUERY
  WITH my_novels AS (
    SELECT n.id, n.translator_id FROM public.novels n WHERE n.translator_id IS NOT NULL
  ),
  purchases AS (
    SELECT
      n.translator_id,
      ct.user_id,
      ABS(ct.amount) AS coins
    FROM public.coin_transactions ct
    JOIN my_novels n ON n.id = (split_part(ct.reference_id, ':', 1))::bigint
    WHERE ct.reason = 'chapter_purchase'
      AND ct.created_at >= p_from
      AND ct.created_at < p_to
  ),
  agg AS (
    SELECT
      translator_id,
      SUM(coins)::bigint          AS coins_gross,
      COUNT(*)::bigint            AS chapter_count,
      COUNT(DISTINCT user_id)::bigint AS unique_buyers
    FROM purchases
    GROUP BY translator_id
  )
  SELECT
    p.id AS translator_id,
    COALESCE(p.translator_display_name, p.user_name, '—') AS translator_name,
    p.translator_slug,
    COALESCE(a.coins_gross, 0)       AS coins_gross,
    COALESCE(a.chapter_count, 0)     AS chapter_count,
    COALESCE(a.unique_buyers, 0)     AS unique_buyers,
    CASE
      WHEN p.payout_tribute_webhook_token IS NOT NULL THEN 'tribute'
      WHEN p.payout_boosty_url IS NOT NULL            THEN 'boosty'
      ELSE NULL
    END AS payout_method,
    p.payout_boosty_url AS payout_ref
  FROM public.profiles p
  LEFT JOIN agg a ON a.translator_id = p.id
  WHERE (p.role = 'translator' OR p.role = 'admin' OR p.is_admin = true)
  ORDER BY a.coins_gross DESC NULLS LAST;
END $$;

GRANT EXECUTE ON FUNCTION public.all_translators_earnings TO authenticated;
