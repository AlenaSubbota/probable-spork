'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { createClient } from '@/utils/supabase/client';

// Silent-логин для Telegram Mini App. Монтируется в root layout, чтобы
// сработать на любой странице, на которую TG откроет Chaptify.
//
// Поведение:
//   1) Детектим, что мы вообще внутри TG (UA / TelegramWebviewProxy).
//      Если нет — ничего не грузим, не делаем сетевых запросов.
//   2) Если уже залогинены через Supabase — стоп (cookie/local есть).
//   3) Локальный флаг tg_explicit_logout — быстрый skip без сетевого
//      запроса. Сервер всё равно перепроверит через
//      profiles.tg_auto_login_blocked_at, поэтому потеря localStorage
//      в Mac TG Desktop не возвращает юзера в систему.
//   4) Лениво грузим telegram-web-app.js, ждём до 2 секунд появления
//      window.Telegram.WebApp.initData (десктопная версия инициализирует
//      WebApp с задержкой), POST'им на /auth/tg/initdata с silent=true.
//      Сервер проверяет tg_auto_login_blocked_at и, если выставлен, шлёт
//      403 auto_login_blocked — мы молча выходим без setSession.
//   5) Делаем hard-reload, чтобы SSR-шапка увидела свежие cookies.

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        ready?: () => void;
      };
    };
    TelegramWebviewProxy?: unknown;
    TelegramWebview?: unknown;
  }
}

function isTelegramEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.TelegramWebviewProxy || window.TelegramWebview) return true;
  if (window.Telegram?.WebApp?.initData) return true;
  const ua = (navigator.userAgent || '').toLowerCase();
  // TG-iOS / TG-Android UA-маркеры. Не 100% надёжно (TG может менять UA),
  // но покрывает версии 2024-2026 и работает как «мы возможно в TG» —
  // дальше всё равно гейтимся initData-ом.
  return /telegram(?:-ios|-android|bot)?/.test(ua);
}

export default function TelegramMiniAppAutoLogin() {
  const ranRef = useRef(false);
  const [shouldLoadSdk, setShouldLoadSdk] = useState(false);

  useEffect(() => {
    if (ranRef.current) return;
    if (typeof window === 'undefined') return;
    if (!isTelegramEnvironment()) return;
    ranRef.current = true;

    let cancelled = false;
    setShouldLoadSdk(true);

    const run = async () => {
      try {
        if (localStorage.getItem('tg_explicit_logout') === 'true') return;
      } catch {
        /* private mode / storage disabled — продолжаем без флага */
      }

      const supabase = createClient();
      const { data: existing } = await supabase.auth.getSession();
      if (cancelled) return;
      if (existing.session) return;

      // Ждём появления initData. SDK инжектит Telegram.WebApp синхронно
      // на iOS/Android, но на десктопе бывают задержки до ~1с пока
      // host-приложение прокидывает данные через postMessage.
      let initData = '';
      for (let i = 0; i < 25; i++) {
        const tg = window.Telegram?.WebApp;
        if (tg) {
          try {
            tg.ready?.();
          } catch {
            /* ignore — не все версии поддерживают ready() сразу */
          }
          if (tg.initData) {
            initData = tg.initData;
            break;
          }
        }
        await new Promise((r) => setTimeout(r, 100));
        if (cancelled) return;
      }
      if (!initData) return;

      let resp: Response;
      try {
        resp = await fetch('/auth/tg/initdata', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // silent=true → сервер уважает profiles.tg_auto_login_blocked_at.
          // Если юзер вышел кнопкой — получим 403 auto_login_blocked, не
          // восстановим сессию, останемся в logged-out UI.
          body: JSON.stringify({ initData, silent: true }),
          cache: 'no-store',
        });
      } catch {
        return;
      }
      if (cancelled) return;
      if (resp.status === 403) {
        // Может быть auto_login_blocked (юзер вышел сам) либо реальный
        // fail подписи. В обоих случаях молча — на /login есть явная
        // кнопка «Войти», там разберёмся.
        try {
          const j = (await resp.json()) as { error?: string };
          if (j.error === 'auto_login_blocked') {
            // Подстраховка: если localStorage вдруг был очищен (новый
            // запуск Mac TG Desktop), серверный отказ всё равно даёт нам
            // источник правды. Восстанавливаем локальный флаг, чтобы
            // следующая навигация в этой сессии не дёргала /auth/tg/initdata
            // вхолостую.
            try {
              localStorage.setItem('tg_explicit_logout', 'true');
            } catch {
              /* private mode — ок, серверная проверка остаётся */
            }
          }
        } catch {
          /* ignore */
        }
        return;
      }
      if (!resp.ok) return;

      let json: { access_token?: string; refresh_token?: string };
      try {
        json = (await resp.json()) as typeof json;
      } catch {
        return;
      }
      if (cancelled) return;
      if (!json.access_token || !json.refresh_token) return;

      const { error } = await supabase.auth.setSession({
        access_token: json.access_token,
        refresh_token: json.refresh_token,
      });
      if (cancelled || error) return;

      try {
        localStorage.removeItem('tg_explicit_logout');
      } catch {
        /* ignore */
      }

      // Дать setSession-у долететь до cookie перед reload — иначе SSR
      // на первом запросе не увидит юзера.
      await new Promise((r) => setTimeout(r, 100));
      if (cancelled) return;
      window.location.replace(
        window.location.pathname + window.location.search,
      );
    };

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!shouldLoadSdk) return null;
  return (
    <Script
      src="https://telegram.org/js/telegram-web-app.js"
      strategy="afterInteractive"
    />
  );
}
