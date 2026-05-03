'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

// Финал Yandex-логина. Server-route /auth/yandex/callback обменял code
// на supabase-сессию через auth-service и navigate сюда с токенами в
// URL-fragment (`#at=...&rt=...`).
//
// На клиенте setSession пишет cookies на домене chaptify.ru — они
// first-party, видны SSR-шапке. После успеха стираем hash из URL-bar
// и делаем hard reload, чтобы SSR увидел юзера.

export default function YandexFinalizePage() {
  const [message, setMessage] = useState('Завершаем вход…');

  useEffect(() => {
    const run = async () => {
      const raw = window.location.hash.startsWith('#')
        ? window.location.hash.slice(1)
        : window.location.hash;
      const params = new URLSearchParams(raw);
      const accessToken = params.get('at');
      const refreshToken = params.get('rt');

      if (!accessToken || !refreshToken) {
        setMessage('Не удалось войти. Перенаправляем…');
        setTimeout(() => {
          window.location.replace('/login?error=yandex_handoff_missing');
        }, 1500);
        return;
      }

      const supabase = createClient();
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (error) {
        setMessage('Не удалось войти. Перенаправляем…');
        setTimeout(() => {
          window.location.replace('/login?error=yandex_setsession_failed');
        }, 1500);
        return;
      }

      // Стереть токены из URL-bar до того, как браузер запомнит их в
      // session history. window.location.replace ниже делает full reload
      // без сохранения текущей записи, но replaceState — гарантия плюс.
      try {
        window.history.replaceState(null, '', '/auth/yandex/finalize');
      } catch {
        /* ignore — не критично */
      }

      // setSession пишет cookies асинхронно; даём событиям долететь до
      // того, как делаем full reload (иначе SSR-шапка может не увидеть
      // юзера на первой загрузке).
      await new Promise((r) => setTimeout(r, 100));

      window.location.replace('/');
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
