import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// Стартовый шаг OAuth-входа через Яндекс.
//
// Yandex не поддерживается self-hosted Supabase натив но (нет
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

export async function GET(request: NextRequest) {
  const clientId = process.env.YANDEX_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(
      new URL('/login?error=yandex_not_configured', request.url),
    );
  }

  // state защищает от CSRF — проверим равенство в callback. 32 байта
  // base64url ≈ 256 бит энтропии, угадать невозможно за разумное время.
  const state = crypto.randomBytes(32).toString('base64url');

  // Redirect URI обязан побайтно совпадать с тем, что зарегистрирован
  // в Yandex OAuth dashboard. Дефолт строим от текущего origin'а
  // (production = chaptify.ru, dev = localhost), но даём env-override
  // на случай нестандартного proxy-rewrite.
  const redirectUri =
    process.env.YANDEX_REDIRECT_URI ||
    `${request.nextUrl.origin}/auth/yandex/callback`;

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
