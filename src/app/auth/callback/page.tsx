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

      // @supabase/ssr browser-client при создании сам видит ?code= в URL
      // и делает exchangeCodeForSession автоматически (detectSessionInUrl
      // включён по умолчанию). Наш ручной exchange ниже — подстраховка
      // на случай если автоматический не прошёл: если сессия уже есть —
      // ручной вернёт ошибку 'code already used', её игнорируем.
      if (code) {
        await supabase.auth.exchangeCodeForSession(code).catch(() => {
          // молча — проверим итог через getSession ниже
        });
      }

      // Даём auth-events долететь (setSession асинхронно пишет cookie)
      await new Promise((r) => setTimeout(r, 100));

      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        // Hard reload — SSR увидит свежую auth-cookie и отрендерит шапку
        // с профилем вместо гостевых кнопок.
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
