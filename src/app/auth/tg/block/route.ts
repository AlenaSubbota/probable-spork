import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

// POST /auth/tg/block — реальный logout для Telegram Mini App.
//
// Берёт текущий access_token из supabase-cookie (создаётся серверным
// клиентом), пробрасывает в auth-service-chaptify /auth/telegram/block,
// который ставит profiles.tg_auto_login_blocked_at = NOW(). После этого
// клиент должен сделать supabase.auth.signOut() и hard-reload — следующий
// silent-login из Mini App вернёт 403 auto_login_blocked, и юзер останется
// в logged-out состоянии до явного «Войти».
//
// Cookies здесь не очищаются: signOut на клиенте делает это нативно
// (и заодно бьёт refresh_token на стороне Supabase, если scope:'global').

export async function POST(_request: NextRequest) {
  const supabase = await createClient();
  // Используем getUser, а не getSession: getSession читает cookies без
  // ревалидации, getUser ходит к Supabase и подтверждает, что токен жив.
  // Без этой проверки злоумышленник с украденной cookie мог бы блокировать
  // автологин чужого аккаунта.
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    return jsonNoStore({ error: 'not_authenticated' }, 401);
  }

  // Достаём access_token из server-сессии для проксирования в auth-service.
  // У getSession есть тонкость: после getUser выше внутренний кэш гидрирован,
  // и getSession отдаёт уже проверенный токен без второго round-trip.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) {
    return jsonNoStore({ error: 'no_token' }, 401);
  }

  const authApiUrl =
    process.env.AUTH_API_INTERNAL_URL || process.env.NEXT_PUBLIC_AUTH_API_URL;
  if (!authApiUrl) {
    return jsonNoStore({ error: 'not_configured' }, 503);
  }

  try {
    const resp = await fetch(`${authApiUrl}/auth/telegram/block`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      // Не падаем громко: фронт всё равно сделает signOut. Худший случай —
      // флаг не выставлен, и при следующем открытии Mini App юзера
      // залогинит обратно. Логируем в server logs для алертинга.
      console.error('[auth/tg/block] upstream returned', resp.status);
      return jsonNoStore({ error: 'upstream_failed' }, 502);
    }
  } catch (err) {
    console.error('[auth/tg/block] network error', err);
    return jsonNoStore({ error: 'network' }, 502);
  }

  return jsonNoStore({ ok: true }, 200);
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
