'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

// Client-side обработчик OAuth callback.
//
// Почему не server-route: PKCE code_verifier ставится в cookie при
// signInWithOAuth на клиенте. Server-side supabase client при exchangeCodeForSession
// должен эту cookie прочитать — но в нашем setup (Supabase на tene.fun,
// клиент на chaptify.ru, куки инкапсулированы @supabase/ssr) cookie
// не долетает на server handler стабильно, и exchange падает с
// "PKCE code verifier not found in storage".
//
// Решение: делаем exchange прямо на клиенте — там cookie точно есть.
// После успешного exchange @supabase/ssr client сам записывает auth-cookie
// на домене chaptify.ru. Дальше hard reload, SSR-шапка видит юзера.

export default function AuthCallbackPage() {
  const [message, setMessage] = useState('Завершаем вход…');

  useEffect(() => {
    const run = async () => {
      const supabase = createClient();
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

      // Перед свежим OAuth-входом инвалидируем любую старую сессию,
      // чтобы избежать code-injection: атакующий навёл жертву на
      // /?code=ATTACKER_CODE&next=/admin/... — если у жертвы была
      // старая сессия, её можно было бы редиректнуть туда под старым
      // юзером. Ждём завершения, иначе signOut гонится с exchangeCodeForSession
      // и может стереть только что установленные cookies.
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
        /* fail open: если signOut упал, exchange ниже всё равно
           перезапишет access/refresh токены атомарно */
      }

      // @supabase/ssr browser-client при создании сам видит ?code= в URL
      // и делает exchangeCodeForSession автоматически. Наш ручной exchange
      // ниже — фолбэк. Ошибки логируем, чтобы не пропустить replay/чужой
      // code, но в UI остаёмся тихими.
      let exchangeOk = false;
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          console.warn('[auth/callback] exchange failed:', error.message);
        } else {
          exchangeOk = true;
        }
      }

      // Даём auth-events долететь (setSession асинхронно пишет cookie)
      await new Promise((r) => setTimeout(r, 100));

      const { data: { session } } = await supabase.auth.getSession();
      // Сессия валидна ТОЛЬКО если этот вход прошёл exchange успешно.
      // Иначе возможна старая сессия, не относящаяся к текущему code.
      if (session && (exchangeOk || !code)) {
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
