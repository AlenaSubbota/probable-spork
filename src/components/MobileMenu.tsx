'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Props {
  isLoggedIn: boolean;
  unreadDm: number;
  unreadNotif: number;
  unreadNews: number;
}

// Гамбургер-меню для мобильного (≤640px). На десктопе скрыт, там живёт
// обычная main-nav + search-box. В drawer — те же ссылки + поиск.
//
// Drawer закрывается: клик по overlay, Esc, смена пути (авто-закрытие
// после клика по ссылке — через useEffect на pathname).
export default function MobileMenu({
  isLoggedIn,
  unreadDm,
  unreadNotif,
  unreadNews,
}: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Закрываем drawer при смене страницы — иначе после клика по пункту
  // он остаётся открытым поверх следующей страницы.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Esc закрывает
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Блокируем скролл body когда drawer открыт
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="mobile-menu-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Закрыть меню' : 'Открыть меню'}
        aria-expanded={open}
        aria-controls="mobile-drawer"
      >
        <span className={`mobile-menu-icon${open ? ' is-open' : ''}`} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>

      <div
        className={`mobile-drawer-overlay${open ? ' is-open' : ''}`}
        onClick={() => setOpen(false)}
        aria-hidden={!open}
      />

      <aside
        id="mobile-drawer"
        className={`mobile-drawer${open ? ' is-open' : ''}`}
        aria-hidden={!open}
      >
        <form action="/search" method="get" className="mobile-drawer-search">
          <input
            type="search"
            name="q"
            placeholder="Поиск по сайту…"
            autoComplete="off"
          />
        </form>

        <nav className="mobile-drawer-nav">
          <Link href="/catalog">Каталог</Link>
          <Link href="/feed">Лента</Link>
          <Link href="/news" className="mobile-drawer-link-with-badge">
            Новости
            {unreadNews > 0 && (
              <span className="nav-unread">{unreadNews}</span>
            )}
          </Link>
          {isLoggedIn && <Link href="/bookmarks">Моя полка</Link>}
          {isLoggedIn && <Link href="/friends">Друзья</Link>}
          {isLoggedIn && (
            <Link href="/messages" className="mobile-drawer-link-with-badge">
              Сообщения
              {unreadDm > 0 && <span className="nav-unread">{unreadDm}</span>}
            </Link>
          )}
          {isLoggedIn && (
            <Link href="/notifications" className="mobile-drawer-link-with-badge">
              Уведомления
              {unreadNotif > 0 && (
                <span className="nav-unread">{unreadNotif}</span>
              )}
            </Link>
          )}
        </nav>

        <div className="mobile-drawer-sep" aria-hidden="true" />

        <nav className="mobile-drawer-nav mobile-drawer-nav--secondary">
          {isLoggedIn ? (
            <>
              <Link href="/profile">Профиль</Link>
              <Link href="/profile/settings">Настройки</Link>
              <Link href="/help">Справка</Link>
            </>
          ) : (
            <>
              <Link href="/login">Войти</Link>
              <Link href="/register">Регистрация</Link>
              <Link href="/help">Справка</Link>
            </>
          )}
        </nav>
      </aside>
    </>
  );
}
