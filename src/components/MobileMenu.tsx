'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ThemeToggle from './ThemeToggle';

interface Props {
  isLoggedIn: boolean;
  unreadDm: number;
  unreadNotif: number;
  unreadNews: number;
}

// Гамбургер-меню для мобильного (≤760px). На десктопе скрыт, там живёт
// обычная main-nav + search-box.
//
// iOS важно: drawer+overlay рендерим через createPortal в document.body,
// иначе они попадают под `.site-header` со своим backdrop-filter —
// это создаёт containing block для position:fixed-потомков, и drawer
// начинает позиционироваться относительно шапки (64 px), а не
// viewport'а. В итоге drawer схлопывается в верхние 64 px — визуально
// ломается до неузнаваемости.
export default function MobileMenu({
  isLoggedIn,
  unreadDm,
  unreadNotif,
  unreadNews,
}: Props) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  // Mounted-флаг — чтобы портал не пытался ходить в document на SSR
  useEffect(() => {
    setMounted(true);
  }, []);

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

  // Блокируем скролл body когда drawer открыт. На iOS одним overflow:hidden
  // не обойтись — мы фиксируем положение + сохраняем текущий scrollY, чтобы
  // восстановить его при закрытии. Иначе под drawer-ом страница «уплывает».
  useEffect(() => {
    if (!open) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const prevPosition = body.style.position;
    const prevTop = body.style.top;
    const prevWidth = body.style.width;
    const prevOverflow = body.style.overflow;

    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';

    return () => {
      body.style.position = prevPosition;
      body.style.top = prevTop;
      body.style.width = prevWidth;
      body.style.overflow = prevOverflow;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  const drawer = (
    <>
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
        <div className="mobile-drawer-head">
          <div className="mobile-drawer-logo">Chaptify</div>
          <button
            type="button"
            className="mobile-drawer-close"
            onClick={() => setOpen(false)}
            aria-label="Закрыть меню"
          >
            ✕
          </button>
        </div>

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

        <div className="mobile-drawer-sep" aria-hidden="true" />
        <div className="mobile-drawer-theme">
          <ThemeToggle />
        </div>
      </aside>
    </>
  );

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

      {mounted && createPortal(drawer, document.body)}
    </>
  );
}
