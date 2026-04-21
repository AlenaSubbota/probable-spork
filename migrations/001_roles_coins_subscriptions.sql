-- ============================================================
-- Миграция 001: роли, монетки, подписки, покупки глав
-- Безопасна для tene.fun: все новые колонки имеют DEFAULT,
-- существующие колонки и RLS НЕ затрагиваются.
-- ============================================================

-- 1. Тип роли пользователя
DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM ('user', 'translator', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Расширяем profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role            public.user_role DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS translator_slug text UNIQUE,
  ADD COLUMN IF NOT EXISTS translator_display_name text,
  ADD COLUMN IF NOT EXISTS translator_avatar_url    text,
  ADD COLUMN IF NOT EXISTS translator_about         text,
  ADD COLUMN IF NOT EXISTS payout_boosty_url        text,
  ADD COLUMN IF NOT EXISTS payout_tribute_channel   text,
  ADD COLUMN IF NOT EXISTS coin_balance             integer DEFAULT 0;

-- Переносим is_admin → role = 'admin'; is_admin оставляем (обратная совместимость tene)
UPDATE public.profiles
SET role = 'admin'
WHERE is_admin = true AND role = 'user';

-- 3. Привязываем переводчика к новелле
ALTER TABLE public.novels
  ADD COLUMN IF NOT EXISTS translator_id uuid REFERENCES public.profiles(id);

-- Все существующие новеллы → первый админ (выставляем translator_id).
-- Если в профилях нет ни одного is_admin=true И ни одного user_name='alena',
-- translator_id останется NULL — код на сайте умеет fallback по author.
UPDATE public.novels
SET translator_id = (
  SELECT id FROM public.profiles
  WHERE is_admin = true OR user_name = 'alena'
  ORDER BY is_admin DESC NULLS LAST
  LIMIT 1
)
WHERE translator_id IS NULL;

-- 4. Таблица подписок (заменяет jsonb в profiles.subscription)
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id)      ON DELETE CASCADE,
  translator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider      text NOT NULL,    -- 'boosty' | 'tribute' | 'card'
  plan          text NOT NULL,    -- 'monthly_basic', 'monthly_pro' ...
  status        text NOT NULL,    -- 'active' | 'expired' | 'pending' | 'cancelled'
  provider_sub_id text,
  started_at    timestamptz DEFAULT now(),
  expires_at    timestamptz,
  UNIQUE (user_id, translator_id, plan, provider)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status
  ON public.subscriptions (user_id, status);

-- 5. Леджер монеток
CREATE TABLE IF NOT EXISTS public.coin_transactions (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount              integer NOT NULL,   -- + пополнение, − списание
  reason              text NOT NULL,      -- 'tribute_topup' | 'boosty_topup' | 'chapter_purchase' | 'admin_adjust'
  reference_type      text,              -- 'chapter' | 'payment' | ...
  reference_id        text,
  provider            text,
  provider_payment_id text UNIQUE,       -- защита от дублирования вебхука
  created_at          timestamptz DEFAULT now()
);

-- 6. Покупки отдельных глав
CREATE TABLE IF NOT EXISTS public.chapter_purchases (
  user_id        uuid    NOT NULL REFERENCES auth.users(id)      ON DELETE CASCADE,
  novel_id       bigint  NOT NULL REFERENCES public.novels(id)   ON DELETE CASCADE,
  chapter_number integer NOT NULL,
  translator_id  uuid    NOT NULL REFERENCES public.profiles(id),
  price_coins    integer NOT NULL,
  paid_at        timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, novel_id, chapter_number)
);

-- 7. Атомарное пополнение баланса
CREATE OR REPLACE FUNCTION public.add_coins(
  p_user              uuid,
  p_amount            int,
  p_reason            text,
  p_provider          text,
  p_provider_payment_id text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.coin_transactions
    (user_id, amount, reason, provider, provider_payment_id)
  VALUES
    (p_user, p_amount, p_reason, p_provider, p_provider_payment_id)
  ON CONFLICT (provider_payment_id) DO NOTHING;

  -- FOUND = true только если INSERT прошёл (не задвоился)
  IF FOUND THEN
    UPDATE public.profiles
    SET coin_balance = coin_balance + p_amount
    WHERE id = p_user;
  END IF;
END $$;

-- 8. Покупка главы за монетки
CREATE OR REPLACE FUNCTION public.buy_chapter(
  p_user    uuid,
  p_novel   bigint,
  p_chapter int,
  p_price   int
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_balance    integer;
  v_translator uuid;
BEGIN
  SELECT coin_balance INTO v_balance
  FROM public.profiles WHERE id = p_user FOR UPDATE;

  IF v_balance IS NULL OR v_balance < p_price THEN
    RETURN false;
  END IF;

  SELECT translator_id INTO v_translator
  FROM public.novels WHERE id = p_novel;

  UPDATE public.profiles
  SET coin_balance = coin_balance - p_price
  WHERE id = p_user;

  INSERT INTO public.coin_transactions
    (user_id, amount, reason, reference_type, reference_id)
  VALUES
    (p_user, -p_price, 'chapter_purchase', 'chapter',
     p_novel::text || ':' || p_chapter::text);

  INSERT INTO public.chapter_purchases
    (user_id, novel_id, chapter_number, translator_id, price_coins)
  VALUES
    (p_user, p_novel, p_chapter, v_translator, p_price)
  ON CONFLICT DO NOTHING;

  RETURN true;
END $$;

-- 9. RPC: проверка доступа к главе
-- Глава доступна если:
--   1. is_paid = false, ИЛИ
--   2. есть активная подписка на переводчика новеллы, ИЛИ
--   3. пользователь купил главу штучно
CREATE OR REPLACE FUNCTION public.can_read_chapter(
  p_user    uuid,
  p_novel   bigint,
  p_chapter int
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_is_paid      boolean;
  v_translator   uuid;
BEGIN
  SELECT c.is_paid, n.translator_id
  INTO v_is_paid, v_translator
  FROM public.chapters c
  JOIN public.novels   n ON n.id = c.novel_id
  WHERE c.novel_id = p_novel AND c.chapter_number = p_chapter
  LIMIT 1;

  -- Бесплатная глава
  IF NOT v_is_paid THEN RETURN true; END IF;

  -- Активная подписка на переводчика
  IF EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id       = p_user
      AND translator_id = v_translator
      AND status        = 'active'
      AND (expires_at IS NULL OR expires_at > now())
  ) THEN RETURN true; END IF;

  -- Штучная покупка
  IF EXISTS (
    SELECT 1 FROM public.chapter_purchases
    WHERE user_id        = p_user
      AND novel_id       = p_novel
      AND chapter_number = p_chapter
  ) THEN RETURN true; END IF;

  RETURN false;
END $$;

-- 10. RPC: статус подписки пользователя на переводчика (совместимость с tene)
--     Возвращает статус в формате аналогичном profiles.subscription
CREATE OR REPLACE FUNCTION public.get_user_subscription_status(p_user uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT jsonb_build_object(
    'active',     bool_or(status = 'active' AND (expires_at IS NULL OR expires_at > now())),
    'expires_at', max(expires_at),
    'plan',       min(plan)
  )
  FROM public.subscriptions
  WHERE user_id = p_user;
$$;

-- Права
GRANT EXECUTE ON FUNCTION public.add_coins TO service_role;
GRANT EXECUTE ON FUNCTION public.buy_chapter TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_chapter TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_user_subscription_status TO authenticated;

GRANT SELECT, INSERT ON public.subscriptions     TO authenticated;
GRANT SELECT, INSERT ON public.coin_transactions TO authenticated;
GRANT SELECT, INSERT ON public.chapter_purchases TO authenticated;
