'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import UserAvatar from './UserAvatar';
import { createClient } from '@/utils/supabase/client';

interface Props {
  userName: string | null;
  avatarUrl: string | null;
  isTranslator: boolean;
  coinBalance: number | null;
}

// Выпадающее меню в шапке для залогиненного пользователя.
// Раньше все действия (админка, новая новелла, настройки и т.д.) были
// прямо в шапке отдельными кнопками — получалось два ряда и тесно.
// Здесь собираем всё под аватарку; шапка становится компактнее.
export default function UserMenu({
  userName,
  avatarUrl,
  isTranslator,
  coinBalance,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Закрытие на клик вне и на Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleLogout = async () => {
    if (!confirm('Выйти из аккаунта?')) return;
    setBusy(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    // Hard reload — SSR рендер layout увидит очищенные cookies
    window.location.href = '/';
    router.refresh();
  };

  return (
    <div className="user-menu" ref={ref}>
      {coinBalance !== null && (
        <Link
          href="/profile/topup"
          className="coin-pill"
          title="Пополнить баланс"
        >
          {coinBalance.toLocaleString('ru-RU')}
        </Link>
      )}
      <button
        type="button"
        className="btn btn-primary header-profile-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <UserAvatar avatarUrl={avatarUrl} name={userName} size={24} />
        <span>{userName ?? 'Профиль'}</span>
        <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 4 }}>▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="user-menu-dropdown"
        >
          <Link href="/profile" className="user-menu-item" onClick={() => setOpen(false)}>
            👤 Мой профиль
          </Link>
          <Link href="/profile/settings" className="user-menu-item" onClick={() => setOpen(false)}>
            ⚙ Настройки
          </Link>
          <Link href="/profile/topup" className="user-menu-item" onClick={() => setOpen(false)}>
            💰 Пополнить баланс
          </Link>
          <Link href="/bookmarks" className="user-menu-item" onClick={() => setOpen(false)}>
            📚 Моя библиотека
          </Link>
          {isTranslator ? (
            <>
              <div className="user-menu-sep" />
              <Link href="/admin" className="user-menu-item" onClick={() => setOpen(false)}>
                🎛 Админка
              </Link>
              <Link href="/admin/novels/new" className="user-menu-item" onClick={() => setOpen(false)}>
                ＋ Новая новелла
              </Link>
            </>
          ) : (
            <>
              <div className="user-menu-sep" />
              <Link href="/translator/apply" className="user-menu-item" onClick={() => setOpen(false)}>
                📝 Стать переводчиком
              </Link>
            </>
          )}
          <div className="user-menu-sep" />
          <button
            type="button"
            className="user-menu-item user-menu-item--danger"
            onClick={handleLogout}
            disabled={busy}
          >
            {busy ? '…' : '↩ Выйти из аккаунта'}
          </button>
        </div>
      )}
    </div>
  );
}
