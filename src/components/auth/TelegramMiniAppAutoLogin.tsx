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
//   2) sessionStorage-guard: если в этой сессии уже логинились через TG
//      и сделали reload — больше не пробуем (защита от loop'а, см.
//      развёрнутый коммент у guard-key ниже).
//   3) Если уже залогинены через Supabase — стоп.
//   4) Если стоит флаг tg_explicit_logout — юзер только что вышел сам,
//      не возвращаем его автоматически (иначе кнопка «Выйти» в TG
//      бесполезна).
//   5) Если Telegram.WebApp ещё нет — лениво грузим telegram-web-app.js.
//      На TG iOS/Android/Desktop объект обычно уже нативно инжектится
//      host-приложением до старта страницы; в этом случае внешний
//      скрипт не нужен (и лишняя задержка, особенно если в Desktop-
//      WebView он виснет).
//   6) Ждём до 5 секунд появления initData, POST'им на
//      /auth/tg/initdata и ставим сессию через supabase.auth.setSession.
//   7) Делаем window.location.reload(), чтобы:
//        - SSR-шапка увидела свежие cookies;
//        - НЕ потерять URL-fragment (`#tgWebAppData=...`), через
//          который TG Desktop передаёт WebApp-контекст. replace с
//          pathname+search hash стирал → reload-цикл.

// Guard-key: stays in sessionStorage только пока живёт WebView/вкладка.
// Сбросится автоматически, когда юзер закроет TG-окно или выйдет из
// мини-аппа. Защищает от случая «cookies от setSession не подхватились
// SSR-ом → getSession() снова null → ещё одна попытка → бесконечный
// reload». Ставим ПЕРЕД reload, на повторном рендере читаем — и пропускаем.
const AUTOLOGIN_GUARD_KEY = 'tg_autologin_attempted';

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

    // Loop-guard: если уже пытались и сделали reload в этой сессии —
    // больше не трогаем. Иначе при любых проблемах с cookie-handoff
    // (Desktop WebView, partitioned storage, и т.п.) получим
    // бесконечный reload.
    try {
      if (sessionStorage.getItem(AUTOLOGIN_GUARD_KEY)) return;
    } catch {
      /* private mode — продолжаем без guard'а, надеемся на cookies */
    }

    ranRef.current = true;
    let cancelled = false;

    // Если объект уже есть нативно (TG-host инжектит) — SDK не грузим.
    // Это и быстрее, и обходит случаи зависания загрузки внешнего
    // скрипта в Desktop-WebView.
    if (!window.Telegram?.WebApp) {
      setShouldLoadSdk(true);
    }

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

      // Ждём появления initData. На iOS/Android нативно почти мгновенно,
      // на Desktop host→webview handshake может затянуться до нескольких
      // секунд. 50*100мс = 5с — компромисс между UX и надёжностью.
      let initData = '';
      for (let i = 0; i < 50; i++) {
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
          body: JSON.stringify({ initData }),
          cache: 'no-store',
        });
      } catch {
        return;
      }
      if (cancelled || !resp.ok) return;

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

      // Ставим guard ДО reload — иначе на следующем рендере, если
      // cookies не подхватятся, попадём в loop.
      try {
        sessionStorage.setItem(AUTOLOGIN_GUARD_KEY, '1');
      } catch {
        /* ignore — пройдём без защиты */
      }

      // Дать setSession-у дописать cookies до reload — иначе SSR
      // на первом запросе не увидит юзера.
      await new Promise((r) => setTimeout(r, 100));
      if (cancelled) return;

      // reload() сохраняет полный URL включая hash. Это критично для
      // TG Desktop, где WebApp-контекст (initData, platform, version)
      // лежит в `#tgWebAppData=...`. replace(pathname+search) стирал
      // hash и провоцировал перерисовку без контекста.
      window.location.reload();
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
