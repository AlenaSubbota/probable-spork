'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

interface Props {
  className?: string;
  label?: string;
}

// Универсальная кнопка выхода. После supabase.auth.signOut() делаем
// hard-reload на '/' — это гарантирует, что SSR увидит очищенные
// cookies и отрендерит гостевую шапку.
export default function LogoutButton({
  className = 'btn btn-ghost',
  label = '↩ Выйти',
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const handleLogout = async () => {
    if (!confirm('Выйти из аккаунта?')) return;
    setBusy(true);
    // Флаг «юзер явно вышел» — нужен, чтобы TelegramMiniAppAutoLogin
    // не вернул его назад раньше, чем юзер сам захочет. Сбрасывается
    // при следующем успешном TG-логине (initData / Login Widget).
    try {
      localStorage.setItem('tg_explicit_logout', 'true');
    } catch {
      /* private mode — ignore */
    }
    const supabase = createClient();
    await supabase.auth.signOut({ scope: 'global' });
    // Используем полный редирект чтобы гарантировать очистку всех
    // кэшей RSC/layout.
    window.location.href = '/';
    // router.refresh() не подходит — layout cache для залогиненного
    // пользователя останется в памяти браузера.
    router.refresh();
  };

  return (
    <button
      type="button"
      className={className}
      onClick={handleLogout}
      disabled={busy}
    >
      {busy ? '…' : label}
    </button>
  );
}
