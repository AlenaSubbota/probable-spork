import { NextRequest, NextResponse } from 'next/server';

// POST /auth/tg/initdata — silent-логин из Telegram Mini App.
//
// Mini App работает внутри Telegram-клиента: TG кладёт в
// window.Telegram.WebApp.initData подписанный URL-encoded payload
// (`query_id=...&user=...&auth_date=...&hash=...`), валидный 1 минуту.
// Этот route принимает initData с фронта, проксирует на
// auth-service-chaptify (там уже есть схема валидации Mini App
// initData по HMAC(`WebAppData`, bot_token) — см. validate() в
// auth-service-chaptify/index.js) и возвращает access/refresh tokens.
//
// Cookies НЕ ставятся здесь — клиент сам вызовет
// supabase.auth.setSession(...). Причина — ровно та же, что для
// /auth/tg (см. подробный коммент там): server-side setSession
// под капотом дёргает getUser к Supabase, который из docker-сети
// chaptify-web заворачивается через nginx и иногда таймаутит.
// Клиентский setSession ходит напрямую из браузера.

interface AuthSession {
  access_token: string;
  refresh_token: string;
}

export async function POST(request: NextRequest) {
  let body: { initData?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ error: 'invalid_json' }, 400);
  }

  const initData = typeof body.initData === 'string' ? body.initData.trim() : '';
  if (!initData) {
    return jsonNoStore({ error: 'no_init_data' }, 400);
  }

  // Грубый sanity-check: initData всегда содержит `hash=` и `auth_date=`.
  // Полная валидация подписи — на стороне auth-service-chaptify, ей
  // нужен TELEGRAM_BOT_TOKEN, которого тут нет.
  if (!initData.includes('hash=') || !initData.includes('auth_date=')) {
    return jsonNoStore({ error: 'malformed' }, 400);
  }

  const authApiUrl =
    process.env.AUTH_API_INTERNAL_URL || process.env.NEXT_PUBLIC_AUTH_API_URL;
  if (!authApiUrl) {
    return jsonNoStore({ error: 'not_configured' }, 503);
  }

  let session: AuthSession | null = null;
  try {
    const resp = await fetch(`${authApiUrl}/auth/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
      cache: 'no-store',
      // Жёсткий таймаут, чтобы не дотянуть до nginx upstream timeout —
      // фронт получит чистую ошибку и сможет молча отступить.
      signal: AbortSignal.timeout(10_000),
    });
    if (resp.status === 403) {
      return jsonNoStore({ error: 'auth_failed' }, 403);
    }
    if (!resp.ok) {
      return jsonNoStore({ error: 'auth_failed' }, 502);
    }
    const data = (await resp.json()) as { session?: AuthSession };
    session = data.session ?? null;
  } catch {
    return jsonNoStore({ error: 'network' }, 502);
  }

  if (!session?.access_token || !session?.refresh_token) {
    return jsonNoStore({ error: 'no_session' }, 502);
  }

  return jsonNoStore(
    {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    },
    200,
  );
}

function jsonNoStore(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
