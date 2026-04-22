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
      const next = url.searchParams.get('next') || '/';

      if (code) {
        // PKCE: обмен code на session
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setMessage('Ошибка входа. Перенаправляем…');
          setTimeout(() => {
            window.location.href =
              '/login?error=' + encodeURIComponent(error.message);
          }, 1500);
          return;
        }
      }
      // Если был implicit flow (hash с access_token), browser-client
      // detectSessionInUrl сам подхватил на createClient() выше.

      // Финальная проверка
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        // Hard reload — чтобы SSR увидел свежие cookies
        window.location.href = next;
      } else {
        window.location.href = '/login?error=oauth_no_session';
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
