import { NextRequest, NextResponse } from 'next/server';

// Колбэк OAuth-флоу Яндекса. Юзер пришёл с ?code=...&state=...
// Проверяем state против cookie, дёргаем auth-service-chaptify
// /auth/yandex для обмена кода на supabase-сессию, и через
// fragment-handoff отдаём токены клиенту (/auth/yandex/finalize).

interface AuthSession {
  access_token: string;
  refresh_token: string;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const yandexError = url.searchParams.get('error');

  // Юзер мог нажать «Отказать» в форме согласия Яндекса.
  if (yandexError) {
    return htmlResponse(errorHtml('yandex_user_denied'));
  }
  if (!code || !state) {
    return htmlResponse(errorHtml('yandex_widget_invalid'));
  }

  const cookieState = request.cookies.get('yandex_oauth_state')?.value;
  if (!cookieState || cookieState !== state) {
    return htmlResponse(errorHtml('yandex_state_mismatch'));
  }

  const authApiUrl =
    process.env.AUTH_API_INTERNAL_URL || process.env.NEXT_PUBLIC_AUTH_API_URL;
  if (!authApiUrl) {
    return htmlResponse(errorHtml('yandex_not_configured'));
  }

  // Тот же redirect_uri, что отправляли на /authorize. Yandex проверит
  // совпадение байт-в-байт при обмене code → token.
  const redirectUri =
    process.env.YANDEX_REDIRECT_URI ||
    `${url.origin}/auth/yandex/callback`;

  let session: AuthSession | null = null;
  try {
    const resp = await fetch(`${authApiUrl}/auth/yandex`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirectUri }),
      cache: 'no-store',
      // Жёсткий timeout — если auth-service висит, не тянем nginx до
      // upstream_read_timeout и 502.
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      return htmlResponse(errorHtml('yandex_auth_failed'));
    }
    const data = (await resp.json()) as { session?: AuthSession };
    session = data.session ?? null;
  } catch {
    return htmlResponse(errorHtml('yandex_network'));
  }

  if (!session?.access_token || !session?.refresh_token) {
    return htmlResponse(errorHtml('yandex_no_session'));
  }

  const resp = htmlResponse(handoffHtml(session.access_token, session.refresh_token));
  // state-cookie одноразовая — снимаем сразу.
  resp.cookies.set('yandex_oauth_state', '', {
    path: '/auth/yandex',
    maxAge: 0,
  });
  return resp;
}

function htmlResponse(html: string): NextResponse {
  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

function handoffHtml(accessToken: string, refreshToken: string): string {
  // JSON.stringify экранирует кавычки. JWT по формату не содержит '<' /
  // '</script>', но на всякий случай дополнительно экранируем '<' →
  // '<' для защиты от теоретического HTML-injection.
  const at = JSON.stringify(accessToken).replace(/</g, '\\u003C');
  const rt = JSON.stringify(refreshToken).replace(/</g, '\\u003C');
  return `<!doctype html>
<meta charset="utf-8">
<title>Готово</title>
<script>
  (function () {
    var at = ${at};
    var rt = ${rt};
    var dest = '/auth/yandex/finalize#at=' + encodeURIComponent(at)
             + '&rt=' + encodeURIComponent(rt);
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
    window.location.replace('/login?error=${encoded}');
  })();
</script>
<noscript>
  <p>Не получилось войти через Яндекс. <a href="/login?error=${encoded}">Вернись на страницу входа</a>.</p>
</noscript>`;
}
