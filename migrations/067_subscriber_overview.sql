-- ============================================================
-- 067: сводка платформенных подписчиков для админ-страницы
--
-- В /admin/subscribers сейчас выводится только список подписчиков
-- из chaptify_subscriptions — те, кого мы у себя зарегистрировали
-- (через подписочную заявку или Boosty/Tribute-автосинк, который
-- нашёл совпадение по email/TG). Реальное количество подписчиков
-- у переводчика на платформах обычно больше: Boosty-API кэш у нас
-- видит всех, кто сейчас числится подписчиком, даже если они не
-- пришли на Chaptify ещё.
--
-- Этот RPC отдаёт UI агрегаты по платформам — без раскрытия личных
-- данных тех, кто к Chaptify не привязан, только цифры.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_my_subscriber_overview()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_me                  uuid := auth.uid();
  v_boosty_cached       int  := 0;
  v_boosty_active       int  := 0;
  v_boosty_synced       timestamptz;
  v_boosty_blog         text;
  v_tribute_pending     int  := 0;
  v_chaptify_active     int  := 0;
  v_chaptify_total_paid int  := 0;
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  -- Boosty: что лежит в нашем кэше синхронизации.
  --   cached      — все строки кэша (часть может быть с истёкшим
  --                 subscribed_until — Boosty помнит «бывших» какое-то
  --                 время для grace-периода, и наш fallback-матчинг
  --                 по email тоже их использует);
  --   active      — у кого подписка ещё не истекла (subscribed_until > now);
  --   synced_at   — когда воркер последний раз обновил кэш.
  -- Если таблицы нет (миграция 049 не накачена) — выходим тихо нулями.
  BEGIN
    SELECT
      COUNT(*),
      COUNT(*) FILTER (
        WHERE subscribed_until IS NULL OR subscribed_until > now()
      ),
      MAX(synced_at)
    INTO v_boosty_cached, v_boosty_active, v_boosty_synced
    FROM public.boosty_subscriber_cache
    WHERE translator_id = v_me;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  BEGIN
    SELECT blog_username
    INTO v_boosty_blog
    FROM public.translator_boosty_credentials
    WHERE translator_id = v_me;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  -- Tribute: оплачено через webhook, но читатель ещё не пришёл с TG.
  BEGIN
    SELECT COUNT(*)
    INTO v_tribute_pending
    FROM public.pending_tribute_subscriptions
    WHERE translator_id = v_me
      AND activated_at IS NULL
      AND expires_at > now();
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  -- chaptify_subscriptions: уже привязанные к юзеру.
  BEGIN
    SELECT
      COUNT(*) FILTER (
        WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())
      ),
      COUNT(*)
    INTO v_chaptify_active, v_chaptify_total_paid
    FROM public.chaptify_subscriptions
    WHERE translator_id = v_me;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'ok',                 true,
    'chaptify_active',    v_chaptify_active,
    'chaptify_total',     v_chaptify_total_paid,
    'boosty',             jsonb_build_object(
      'cached',          v_boosty_cached,
      'active_in_cache', v_boosty_active,
      'last_synced_at',  v_boosty_synced,
      'blog_username',   v_boosty_blog
    ),
    'tribute',            jsonb_build_object(
      'pending_link', v_tribute_pending
    )
  );
END $$;

REVOKE ALL    ON FUNCTION public.get_my_subscriber_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_subscriber_overview() TO authenticated;
