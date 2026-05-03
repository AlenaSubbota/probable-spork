import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// Стартовый шаг OAuth-входа через Яндекс.
//
// Yandex не поддерживается self-hosted Supabase нативно (нет
// GOTRUE_EXTERNAL_YANDEX_*), поэтому весь обмен code → session делаем
// через auth-service-chaptify (см. POST /auth/yandex там). Cookie-handoff
// устроен как в Telegram-флоу: токены приходят в URL fragment на
// /auth/yandex/finalize, чтобы не утекать в access logs nginx и Referer.
//
// Для регистрации приложения в Яндексе:
//   https://oauth.yandex.ru/client/new
//   Платформа: Веб-сервисы
//   Callback URI: https://chaptify.ru/auth/yandex/callback
//   Права: login:email, login:info

const YANDEX_AUTHORIZE_URL = 'https://oauth.yandex.ru/authorize';

// Внутри docker-контейнера request.nextUrl.origin часто превращается
// в `https://<container-id>:3000` — Host header идёт сырой от внешнего
// nginx. Yandex такой redirect_uri отклонит (не совпадёт с тем, что
// зарегистрирован), а если мы шлём юзера на /login — Safari ловит
// «не удаётся найти сервер d4d4542b6c80». Берём публичный origin из
// x-forwarded-* заголовков, которые ставит nginx-proxy.
function getPublicOrigin(request: NextRequest): string {
  const fwdHost = request.headers.get('x-forwarded-host');
  const fwdProto = request.headers.get('x-forwarded-proto') || 'https';
  if (fwdHost) return `${fwdProto}://${fwdHost}`;
  return request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  const clientId = process.env.YANDEX_CLIENT_ID;
  if (!clientId) {
    return htmlResponse(errorHtml('yandex_not_configured'));
  }

  // state защищает от CSRF — проверим равенство в callback. 32 байта
  // base64url ≈ 256 бит энтропии, угадать невозможно за разумное время.
  const state = crypto.randomBytes(32).toString('base64url');

  // Redirect URI обязан побайтно совпадать с тем, что зарегистрирован
  // в Yandex OAuth dashboard. Дефолт строим от публичного origin'а
  // (production = chaptify.ru), env-override на случай нестандартного
  // proxy-rewrite.
  const redirectUri =
    process.env.YANDEX_REDIRECT_URI ||
    `${getPublicOrigin(request)}/auth/yandex/callback`;

  const authorizeUrl = new URL(YANDEX_AUTHORIZE_URL);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', state);
  // Не дёргать форму подтверждения у юзеров, которые уже разрешали
  // нашему приложению этот scope.
  authorizeUrl.searchParams.set('force_confirm', 'no');

  const resp = NextResponse.redirect(authorizeUrl.toString(), { status: 302 });
  resp.cookies.set('yandex_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    // Cookie должна долететь до /auth/yandex/callback — он лежит ниже
    // /auth/yandex, поэтому такой path подходит и не светит cookie на
    // остальном сайте.
    path: '/auth/yandex',
    maxAge: 600,
  });
  return resp;
}

// Server-side error → клиентский редирект на /login?error=<reason>.
// Не используем NextResponse.redirect(new URL('/login?...', request.url)):
// внутри docker-контейнера request.url содержит internal hostname
// (e.g. https://d4d4542b6c80:3000), и Safari потом не может его
// зарезолвить. window.location.replace() в браузере резолвится
// относительно текущего домена (chaptify.ru) — вне зависимости от
// того, какой Host видел Next.
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
