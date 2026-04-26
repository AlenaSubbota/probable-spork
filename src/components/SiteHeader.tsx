import Link from 'next/link';
import { createClient } from '@/utils/supabase/server';
import UserMenu from './UserMenu';
import MobileMenu from './MobileMenu';
import ThemeToggle from './ThemeToggle';
import HeaderSearch from './search/HeaderSearch';

export default async function SiteHeader() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let userName: string | null = null;
  let avatarUrl: string | null = null;
  let isTranslator = false;
  let coinBalance: number | null = null;
  let unreadDm = 0;
  let unreadNotif = 0;
  let unreadNews = 0;

  if (user) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();
    if (data) {
      const p = data as {
        user_name?: string | null;
        role?: string;
        is_admin?: boolean;
        coin_balance?: number | null;
        avatar_url?: string | null;
      };
      userName = p.user_name ?? null;
      avatarUrl = p.avatar_url ?? null;
      isTranslator =
        p.is_admin === true || p.role === 'translator' || p.role === 'admin';
      if (typeof p.coin_balance === 'number') coinBalance = p.coin_balance;
    }

    // Непрочитанные сообщения (RPC из миграции 006)
    try {
      const { data: count } = await supabase.rpc('unread_dm_count');
      if (typeof count === 'number') unreadDm = count;
    } catch {
      // миграция 006 ещё не накачена
    }
    // Непрочитанные уведомления (RPC из миграции 007)
    try {
      const { data: count } = await supabase.rpc('unread_notifications_count');
      if (typeof count === 'number') unreadNotif = count;
    } catch {
      // миграция 007 ещё не накачена
    }
    // Непрочитанные новости (RPC из миграции 009)
    try {
      const { data: count } = await supabase.rpc('unread_news_count');
      if (typeof count === 'number') unreadNews = count;
    } catch {
      // миграция 009 ещё не накачена
    }
  }

  return (
    <header className="site-header">
      <div className="container header-row">
        {/* Гамбургер — виден только на мобиле (CSS скрывает на ≥641px) */}
        <MobileMenu
          isLoggedIn={!!user}
          unreadDm={unreadDm}
          unreadNotif={unreadNotif}
          unreadNews={unreadNews}
        />

        <Link href="/" className="logo">
          <div className="logo-mark">C</div>
          Chaptify
        </Link>

        {/* Browse-навигация: текстовые пункты для всех. Личные действия
            переехали в .header-utilities справа (иконки-кружки), чтобы
            не громоздить 7 текстовых ссылок в один ряд. */}
        <nav className="main-nav" aria-label="Каталог и подборки">
          <Link href="/catalog">Каталог</Link>
          <Link href="/feed">Лента</Link>
          <Link href="/news" className="nav-with-badge">
            Новости
            {unreadNews > 0 && <span className="nav-unread">{unreadNews}</span>}
          </Link>
        </nav>

        <HeaderSearch />

        {user && (
          <nav className="header-utilities" aria-label="Личное">
            <Link
              href="/bookmarks"
              className="header-util"
              aria-label="Полка"
              title="Полка"
            >
              <span className="header-util-icon" aria-hidden="true">📚</span>
              <span className="header-util-label">Полка</span>
            </Link>
            <Link
              href="/friends"
              className="header-util"
              aria-label="Друзья"
              title="Друзья"
            >
              <span className="header-util-icon" aria-hidden="true">👥</span>
              <span className="header-util-label">Друзья</span>
            </Link>
            <Link
              href="/messages"
              className="header-util"
              aria-label="Сообщения"
              title="Сообщения"
            >
              <span className="header-util-icon" aria-hidden="true">💬</span>
              <span className="header-util-label">Сообщения</span>
              {unreadDm > 0 && (
                <span className="header-util-badge" aria-label={`${unreadDm} непрочитанных`}>
                  {unreadDm > 99 ? '99+' : unreadDm}
                </span>
              )}
            </Link>
            <Link
              href="/notifications"
              className="header-util"
              aria-label="Уведомления"
              title="Уведомления"
            >
              <span className="header-util-icon" aria-hidden="true">🔔</span>
              <span className="header-util-label">Уведомления</span>
              {unreadNotif > 0 && (
                <span className="header-util-badge" aria-label={`${unreadNotif} непрочитанных`}>
                  {unreadNotif > 99 ? '99+' : unreadNotif}
                </span>
              )}
            </Link>
          </nav>
        )}

        <div className="header-actions">
          <div className="header-theme-toggle">
            <ThemeToggle />
          </div>
          {user ? (
            <UserMenu
              userName={userName}
              avatarUrl={avatarUrl}
              isTranslator={isTranslator}
              coinBalance={coinBalance}
            />
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost">
                Войти
              </Link>
              <Link href="/register" className="btn btn-primary">
                Регистрация
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
