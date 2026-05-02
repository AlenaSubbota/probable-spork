'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

// Финал Telegram-логина. Server-route /auth/tg валидирует подпись
// через auth-service-chaptify, забирает access/refresh токены и
// делает navigate сюда с токенами в URL-fragment (`#at=...&rt=...`).
//
// На клиенте мы вызываем supabase.auth.setSession(...) — это:
//   - пишет cookies на домене chaptify.ru (first-party, видны SSR-шапке);
//   - под капотом валидирует access_token через `getUser` к
//     NEXT_PUBLIC_SUPABASE_URL — этот вызов происходит из браузера,
//     минуя docker-сетевую петлю, в которой висел server-side setSession.
//
// Hash (`#`) не уходит в HTTP-запрос → токены не пишутся в access logs
// nginx и не утекают в Referer на следующих переходах. После успеха
// делаем history.replaceState, чтобы стереть hash из URL-bar.

export default function TgFinalizePage() {
  const [message, setMessage] = useState('Завершаем вход…');

  useEffect(() => {
    const run = async () => {
      // Парсим hash. window.location.hash содержит ведущий '#'.
      const raw = window.location.hash.startsWith('#')
        ? window.location.hash.slice(1)
        : window.location.hash;
      const params = new URLSearchParams(raw);
      const accessToken = params.get('at');
      const refreshToken = params.get('rt');

      if (!accessToken || !refreshToken) {
        setMessage('Не удалось войти. Перенаправляем…');
        setTimeout(() => {
          window.location.replace('/login?error=tg_handoff_missing');
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
          window.location.replace('/login?error=tg_setsession_failed');
        }, 1500);
        return;
      }

      // Стереть токены из URL-bar до того, как браузер запомнит их в
      // session history. window.location.replace ниже делает hard reload
      // без сохранения текущей записи в history, так что hash не
      // останется кешированным. Но replaceState — гарантия плюс защита
      // на случай, если юзер задержится на этой странице (например,
      // сетевая задержка перед reload).
      try {
        window.history.replaceState(null, '', '/auth/tg/finalize');
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
