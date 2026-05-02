'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

// Client-side обработчик OAuth callback.
//
// Почему не server-route: PKCE code_verifier ставится в cookie при
// signInWithOAuth на клиенте. Server-side supabase client при
// exchangeCodeForSession должен эту cookie прочитать — но в нашем setup
// (Supabase на tene.fun, клиент на chaptify.ru, куки инкапсулированы
// @supabase/ssr) cookie не долетает на server handler стабильно, и
// exchange падает с "PKCE code verifier not found in storage".
//
// Решение: делаем exchange прямо на клиенте — там cookie точно есть.
// После успешного exchange @supabase/ssr client сам записывает auth-cookie
// на домене chaptify.ru. Дальше hard reload, SSR-шапка видит юзера.
//
// Тонкость: createBrowserClient (@supabase/ssr) c PKCE-flow и
// detectSessionInUrl: true (дефолт) при инициализации сам видит ?code=
// в URL и асинхронно вызывает exchangeCodeForSession. Если сразу
// после createClient() звать ещё раз вручную — гонка: либо «code already
// used», либо двойное переписывание cookies. Поэтому слушаем SIGNED_IN
// от auto-detect, а ручной exchange оставляем фолбэком и игнорируем
// его ошибку «code already used».

export default function AuthCallbackPage() {
  const [message, setMessage] = useState('Завершаем вход…');

  useEffect(() => {
    const run = async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');
      const rawNext = url.searchParams.get('next') || '/';

      // Защита от open-redirect: парсим next как URL относительно нашего origin
      // и отбрасываем всё, что после нормализации указывает на чужой хост.
      // Старая текстовая проверка startsWith('/') пропускала /\evil.com —
      // Chrome нормализует обратные слеши в // и улетает на фишинг.
      let next = '/';
      try {
        const candidate = new URL(rawNext, window.location.origin);
        if (
          candidate.origin === window.location.origin &&
          candidate.pathname.startsWith('/')
        ) {
          next = candidate.pathname + candidate.search + candidate.hash;
        }
      } catch {
        next = '/';
      }

      // Подписываемся на SIGNED_IN ДО того как auto-detect успеет завершить
      // обмен (он стартует в createClient ниже). Этот флаг — единственный
      // надёжный признак, что код был обменян именно для текущего захода:
      // ловит и auto-detect, и ручной фолбэк ниже.
      const supabase = createClient();
      let signedInForThisFlow = false;
      const { data: authSub } = supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_IN') signedInForThisFlow = true;
      });

      // Ручной exchange как фолбэк — если auto-detect по какой-то причине
      // не отработал. Если уже отработал, получим "code already used" /
      // "invalid request" — это норма, не ошибка.
      if (code) {
        try {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (!error) signedInForThisFlow = true;
          // ошибки не логируем как warn — auto-detect делает это легитимно
        } catch {
          /* ignore */
        }
      }

      // Дать SIGNED_IN-event от auto-detect долететь и cookies записаться.
      // 400 мс эмпирически достаточно: сетевой запрос к Supabase + setSession.
      await new Promise((r) => setTimeout(r, 400));

      const { data: { session } } = await supabase.auth.getSession();
      authSub.subscription.unsubscribe();

      // Если в URL был code — пускаем дальше только если этот вход
      // действительно прошёл exchange (защита от code-injection: атакующий
      // мог подсунуть жертве /auth/callback?code=ATT&next=/admin при уже
      // живой сессии; если exchange не отстрелил SIGNED_IN — старая сессия
      // остаётся, но мы её не считаем валидной для редиректа на next).
      const ok = code ? (!!session && signedInForThisFlow) : !!session;

      if (ok) {
        window.location.href = next;
      } else {
        setMessage('Не удалось войти. Перенаправляем…');
        setTimeout(() => {
          window.location.href = '/login?error=oauth_failed';
        }, 1500);
      }
    };
    run();
  }, []);

  return (
    <main
      style={{
        minHeight: '50vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-serif)',
        fontSize: 16,
        color: 'var(--ink-soft)',
      }}
    >
      <div>{message}</div>
    </main>
  );
}
