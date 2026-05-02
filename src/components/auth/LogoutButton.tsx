'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

interface Props {
  className?: string;
  label?: string;
}

// Универсальная кнопка выхода.
//
// Внутри Telegram Mini App «logout» структурно непростой: TG-аккаунт
// — постоянный, и наш TelegramMiniAppAutoLogin при следующем рендере
// автоматически восстановит сессию через initData. Поэтому в Mini App
// перед обычным supabase signOut делаем ещё один шаг: дёргаем
// /auth/tg/block, который ставит profiles.tg_auto_login_blocked_at.
// На стороне auth-service-chaptify silent-логин теперь упрётся в этот
// флаг и вернёт 403 — юзер останется в logged-out состоянии до явного
// клика «Войти». Флаг сбрасывается в /auth/telegram при silent=false.
//
// Раньше здесь была эвристика «в Mini App вместо выхода закрываем
// приложение»: проблема в том, что localStorage в Mac TG Desktop не
// переживает рестарт. Серверный флаг это решает.

export default function LogoutButton({
  className = 'btn btn-ghost',
  label = '↩ Выйти',
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (!confirm('Выйти из аккаунта?')) return;
    setBusy(true);

    // 1. Серверный флаг — главное. Если упадёт сеть, всё равно идём
    //    дальше: signOut обнулит локальную сессию, юзер увидит logged-out
    //    UI; в худшем случае при перезаходе в Mini App автологин вернёт
    //    его обратно — но это лучше, чем «нажал и ничего не произошло».
    try {
      await fetch('/auth/tg/block', {
        method: 'POST',
        cache: 'no-store',
      });
    } catch {
      /* ignore — пробрасываем юзера на signOut в любом случае */
    }

    // 2. Локальный флаг как defence in depth: даже если /auth/tg/block
    //    не отработал, в текущем процессе TelegramMiniAppAutoLogin
    //    увидит флаг и не будет дёргать silent-login.
    try {
      localStorage.setItem('tg_explicit_logout', 'true');
    } catch {
      /* private mode */
    }

    // 3. signOut с scope:'global' — инвалидируем refresh_token серверно.
    const supabase = createClient();
    await supabase.auth.signOut({ scope: 'global' });

    // 4. Hard reload на /login, чтобы SSR layout увидел очищенные cookies
    //    и юзер сразу попал на форму входа (а не на guest-версию страницы,
    //    где он только что был).
    window.location.href = '/login';
    router.refresh();
  };

  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      disabled={busy}
    >
      {busy ? '…' : label}
    </button>
  );
}
