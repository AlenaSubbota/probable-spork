'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

interface Props {
  className?: string;
  label?: string;
}

// Универсальная кнопка выхода.
//
// Внутри Telegram Mini App «logout» структурно бесполезен: идентичность
// юзера ЭТО его TG-аккаунт, и при следующем открытии Mini App'а наш
// auto-login (TelegramMiniAppAutoLogin) сразу его залогинит. tg_explicit_logout
// флаг в localStorage пытался это блокировать, но в Mac TG Desktop WebView
// storage между сессиями Mini App'а не всегда переживает закрытие приложения
// → флаг теряется → юзер бесконечно «выходит и снова входит».
//
// Поэтому в TG-окружении кнопка переименовывается в «Закрыть» и вызывает
// Telegram.WebApp.close(): закрывает Mini App. Хочешь логин под другим
// аккаунтом — переключи аккаунт в Telegram. Хочешь полный signOut с
// очисткой cookies — открой chaptify.ru в обычном браузере.
//
// В обычном браузере поведение прежнее: signOut + hard-reload на '/'.

// NB: глобальный Window.Telegram уже объявлен в TelegramMiniAppAutoLogin.tsx
// со свойством `ready?`. Объявить его тут ещё раз с другим набором
// (`close?`) нельзя — TS ругается «Subsequent property declarations must
// have the same type». Поэтому достаём WebApp через локальный cast,
// без global-augmentation. Тот же паттерн — в TelegramLoginWidget.tsx.
type TgWebApp = {
  initData?: string;
  close?: () => void;
};

function getTelegramWebApp(): TgWebApp | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    Telegram?: { WebApp?: TgWebApp };
  };
  return w.Telegram?.WebApp;
}

function hasMiniAppInitData(): boolean {
  // initData — единственный надёжный признак, что мы именно в Mini App
  // (а не просто во встроенном браузере TG, где Telegram.WebApp.close()
  // не доступен / не закроет ничего полезного).
  return !!getTelegramWebApp()?.initData;
}

export default function LogoutButton({
  className = 'btn btn-ghost',
  label,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // SSR не знает, что юзер в TG — детектим только на клиенте, чтобы
  // не было hydration-mismatch'а. До маунта показываем дефолтный
  // лейбл «Выйти».
  const [inMiniApp, setInMiniApp] = useState(false);

  useEffect(() => {
    if (hasMiniAppInitData()) {
      setInMiniApp(true);
      return;
    }

    // SDK telegram-web-app.js может загружаться асинхронно (его
    // подгружает <Script strategy="afterInteractive"> в
    // TelegramMiniAppAutoLogin), а LogoutButton маунтится раньше.
    // Поэтому на первом вызове initData может быть пустой даже в
    // настоящем Mini App. Поллим до 3 секунд, чтобы поймать момент,
    // когда SDK подставит initData в window.Telegram.WebApp.
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 30; // 30 * 100ms = 3s

    const tick = () => {
      if (cancelled) return;
      attempts++;
      if (hasMiniAppInitData()) {
        setInMiniApp(true);
        return;
      }
      if (attempts < maxAttempts) {
        setTimeout(tick, 100);
      }
      // После maxAttempts молча сдаёмся — значит юзер не в Mini App,
      // оставляем стандартное поведение signOut.
    };
    setTimeout(tick, 100);

    return () => {
      cancelled = true;
    };
  }, []);

  const handleClick = async () => {
    if (inMiniApp) {
      // В Mini App «выход» = закрытие приложения. Не делаем signOut —
      // супабейс-сессию оставляем как есть, при следующем открытии
      // юзер просто вернётся залогиненным (что и ожидается в TG).
      try {
        getTelegramWebApp()?.close?.();
      } catch {
        /* ignore — на старых клиентах метода может не быть */
      }
      return;
    }

    if (!confirm('Выйти из аккаунта?')) return;
    setBusy(true);
    const supabase = createClient();
    await supabase.auth.signOut({ scope: 'global' });
    // Полный редирект, чтобы гарантировать очистку всех кэшей RSC/layout.
    window.location.href = '/';
    router.refresh();
  };

  const effectiveLabel =
    label ?? (inMiniApp ? '✕ Закрыть Chaptify' : '↩ Выйти');

  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      disabled={busy}
    >
      {busy ? '…' : effectiveLabel}
    </button>
  );
}
