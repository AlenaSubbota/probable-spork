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

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        close?: () => void;
      };
    };
  }
}

function isTelegramMiniApp(): boolean {
  if (typeof window === 'undefined') return false;
  // initData — единственный надёжный признак, что мы именно в Mini App
  // (а не просто во встроенном браузере TG, где Telegram.WebApp.close()
  // не доступен / не закроет ничего полезного).
  return !!window.Telegram?.WebApp?.initData;
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
    setInMiniApp(isTelegramMiniApp());
  }, []);

  const handleClick = async () => {
    if (inMiniApp) {
      // В Mini App «выход» = закрытие приложения. Не делаем signOut —
      // супабейс-сессию оставляем как есть, при следующем открытии
      // юзер просто вернётся залогиненным (что и ожидается в TG).
      try {
        window.Telegram?.WebApp?.close?.();
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
