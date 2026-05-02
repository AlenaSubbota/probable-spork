import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Telegram Login Widget в режиме `data-auth-url` редиректит браузер сюда
// после успешной авторизации в @chaptifybot. Параметры подписаны токеном
// бота — валидируем подпись через `auth-service-chaptify` (общий сервис,
// тот же что использовал старый client-side fetch на /auth/telegram).
//
// Зачем нужен этот route, если auth-service сам отдаёт session:
// - в data-auth-url виджет делает полноразмерный навигейшн (а не postMessage
//   как старый data-onauth), значит client-side JS-обработчик не запустится
//   и нужно поставить cookies на сервере прямо в этот же HTTP-ответ;
// - этот же route корректно работает в in-app браузере Telegram —
//   там как раз не было postMessage между попапом и opener'ом, и старый
//   data-onauth отказывал тихо.
//
// Путь специально не /auth/telegram — на проде nginx перехватывает этот
// префикс и шлёт в supabase-auth-tg-chaptify напрямую (см. PROGRESS-AUTH.md).
// Если переименуешь — обнови data-auth-url в TelegramLoginWidget.tsx.

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

  const authApiUrl = process.env.NEXT_PUBLIC_AUTH_API_URL;
  if (!authApiUrl) {
    // Без явного ENV не отправляем widget-payload никуда — иначе любой,
    // кто контролирует дефолт, мог бы подменить trust-root. Лучше тихий
    // отказ, чем отправка подписанных данных на чужой сервис.
    return htmlResponse(errorHtml('tg_not_configured'));
  }

  let session: AuthSession | null = null;
  try {
    const resp = await fetch(`${authApiUrl}/auth/telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ widgetData }),
      cache: 'no-store',
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

  // HTML-ответ + Set-Cookie от @supabase/ssr на ОДНОМ ответе. Когда
  // браузер отрисует HTML и JS закроет попап / сделает навигейшн,
  // cookies уже лежат на chaptify.ru first-party.
  const response = htmlResponse(successHtml());

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach((c) => response.cookies.set(c.name, c.value, c.options));
        },
      },
    }
  );

  await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });

  return response;
}

function htmlResponse(html: string): NextResponse {
  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Кешировать нечего: ответ зависит от подписанных query.
      'Cache-Control': 'no-store',
    },
  });
}

function successHtml(): string {
  // Виджет может работать в двух режимах:
  //   1) Popup — открыт maan-окном, после редиректа сюда есть window.opener.
  //      Обновляем opener (чтобы SSR-шапка увидела свежие cookies) и
  //      закрываем попап.
  //   2) Full-page (in-app TG, или когда popup заблокирован) — opener'а
  //      нет, делаем навигейшн в текущем окне.
  return `<!doctype html>
<meta charset="utf-8">
<title>Готово</title>
<script>
  (function () {
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.location.href = '/';
        window.close();
        return;
      }
    } catch (_) { /* cross-origin opener — ниже fallback */ }
    window.location.replace('/');
  })();
</script>
<noscript>
  <p>Готово. <a href="/">Вернись на главную</a>, если страница не обновилась автоматически.</p>
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
