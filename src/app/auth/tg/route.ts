import { NextRequest, NextResponse } from 'next/server';

// Telegram Login Widget в режиме `data-auth-url` редиректит браузер сюда
// после успешной авторизации в @chaptifybot. Параметры подписаны токеном
// бота — валидируем подпись через `auth-service-chaptify` (общий сервис,
// тот же что использовал старый client-side fetch на /auth/telegram).
//
// Архитектурное замечание про cookies:
//
// Сначала мы пробовали ставить supabase auth-cookies прямо тут, на
// сервере, через `createServerClient(...).auth.setSession(...)`. Но
// setSession под капотом делает HTTP-вызов `getUser` на
// NEXT_PUBLIC_SUPABASE_URL для валидации только что выпущенного
// access_token. Из docker-контейнера chaptify-web этот вызов идёт
// через extra_hosts → host-gateway → внешний nginx → внутренний
// Supabase, и в нашей сетке этот круг подвисал — nginx upstream
// timeout заворачивал юзеру 502 ДО того, как handler успевал отдать
// ответ.
//
// Решение: handler здесь проверяет подпись и забирает access/refresh
// токены, но cookies ставятся на КЛИЕНТЕ через `/auth/tg/finalize`
// (см. соседний page.tsx). Токены передаём через URL-fragment (`#`),
// который не уходит в HTTP-запрос (а значит и в access logs / Referer
// / nginx upstream). Это убирает сетевую петлю и любые server-side
// вызовы к Supabase из этого route.
//
// Путь специально не /auth/telegram — на проде nginx перехватывает
// этот префикс и шлёт в supabase-auth-tg-chaptify напрямую (см.
// PROGRESS-AUTH.md). Если переименуешь — обнови data-auth-url в
// TelegramLoginWidget.tsx.

interface WidgetData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

interface AuthSession {
  access_token: string;
  refresh_token: string;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);

  const id = Number(url.searchParams.get('id'));
  const hash = url.searchParams.get('hash');
  const authDate = Number(url.searchParams.get('auth_date'));
  const firstName = url.searchParams.get('first_name');

  // Минимальный sanity-check, чтобы не нагружать auth-service очевидным
  // мусором. Полная проверка подписи — там, она требует TELEGRAM_BOT_TOKEN.
  if (!id || !hash || !authDate || !firstName) {
    return htmlResponse(errorHtml('tg_widget_invalid'));
  }

  const widgetData: WidgetData = {
    id,
    hash,
    auth_date: authDate,
    first_name: firstName,
    last_name: url.searchParams.get('last_name') ?? undefined,
    username: url.searchParams.get('username') ?? undefined,
    photo_url: url.searchParams.get('photo_url') ?? undefined,
  };

  // Базовый URL auth-сервиса. Предпочитаем внутренний docker-host
  // (без TLS, без выхода в интернет, без round-trip через nginx).
  // Fallback — NEXT_PUBLIC_AUTH_API_URL.
  const authApiUrl =
    process.env.AUTH_API_INTERNAL_URL || process.env.NEXT_PUBLIC_AUTH_API_URL;
  if (!authApiUrl) {
    return htmlResponse(errorHtml('tg_not_configured'));
  }

  let session: AuthSession | null = null;
  try {
    const resp = await fetch(`${authApiUrl}/auth/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ widgetData }),
      cache: 'no-store',
      // Жёсткий timeout: иначе зависший fetch (DNS/TLS/upstream) дотянет
      // до nginx upstream_read_timeout и вернёт 502 без шансов на errorHtml.
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      return htmlResponse(errorHtml('tg_auth_failed'));
    }
    const data = (await resp.json()) as { session?: AuthSession };
    session = data.session ?? null;
  } catch {
    return htmlResponse(errorHtml('tg_network'));
  }

  if (!session?.access_token || !session?.refresh_token) {
    return htmlResponse(errorHtml('tg_no_session'));
  }

  // HTML с навигейшном на /auth/tg/finalize#at=...&rt=...
  // Hash НЕ уходит в HTTP-запрос — handoff остаётся на клиенте.
  return htmlResponse(handoffHtml(session.access_token, session.refresh_token));
}

function htmlResponse(html: string): NextResponse {
  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Кешировать нечего: ответ зависит от подписанных query и
      // содержит свежие токены — никакого CDN-кеша.
      'Cache-Control': 'no-store',
      // Не светить странице referrer'ом дальше — токены в hash, но
      // на всякий случай.
      'Referrer-Policy': 'no-referrer',
    },
  });
}

function handoffHtml(accessToken: string, refreshToken: string): string {
  // JSON.stringify экранирует кавычки. Вставка в JS-литерал безопасна,
  // т.к. JWT по формату не содержит </script> или подобного.
  // На всякий случай дополнительно экранируем '<' → '<' —
  // защита от теоретического HTML-injection если когда-нибудь access_token
  // начнёт содержать произвольные символы.
  const at = JSON.stringify(accessToken).replace(/</g, '\\u003C');
  const rt = JSON.stringify(refreshToken).replace(/</g, '\\u003C');

  // Виджет может работать в двух режимах (popup / full-page) — finalize
  // разруливает оба. Тут просто навигация туда же, в зависимости от
  // того, есть ли opener.
  return `<!doctype html>
<meta charset="utf-8">
<title>Готово</title>
<script>
  (function () {
    var at = ${at};
    var rt = ${rt};
    // Передаём токены через URL-fragment — он живёт только в браузере,
    // не уходит в HTTP-запрос, не пишется в access logs.
    var dest = '/auth/tg/finalize#at=' + encodeURIComponent(at)
             + '&rt=' + encodeURIComponent(rt);
    try {
      if (window.opener && !window.opener.closed) {
        // Popup-режим: главное окно ведём на finalize, попап закрываем.
        window.opener.location.replace(dest);
        window.close();
        return;
      }
    } catch (_) { /* cross-origin opener — fallthrough */ }
    window.location.replace(dest);
  })();
</script>
<noscript>
  <p>Включи JavaScript, чтобы завершить вход.</p>
</noscript>`;
}

function errorHtml(reason: string): string {
  const encoded = encodeURIComponent(reason);
  return `<!doctype html>
<meta charset="utf-8">
<title>Ошибка входа</title>
<script>
  (function () {
    var url = '/login?error=${encoded}';
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.location.href = url;
        window.close();
        return;
      }
    } catch (_) { /* fallthrough */ }
    window.location.replace(url);
  })();
</script>
<noscript>
  <p>Не получилось войти через Telegram. <a href="/login?error=${encoded}">Вернись на страницу входа</a>.</p>
</noscript>`;
}
