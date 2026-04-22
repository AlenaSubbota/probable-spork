import Link from 'next/link';
import { createClient } from '@/utils/supabase/server';
import UserMenu from './UserMenu';

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
        <Link href="/" className="logo">
          <div className="logo-mark">C</div>
          Chaptify
        </Link>

        <nav className="main-nav">
          <Link href="/catalog">Каталог</Link>
          <Link href="/feed">Лента</Link>
          <Link href="/news" className="nav-with-badge">
            Новости
            {unreadNews > 0 && <span className="nav-unread">{unreadNews}</span>}
          </Link>
          {user && <Link href="/bookmarks">Полка</Link>}
          {user && <Link href="/friends">Друзья</Link>}
          {user && (
            <Link href="/messages" className="nav-with-badge">
              Сообщения
              {unreadDm > 0 && <span className="nav-unread">{unreadDm}</span>}
            </Link>
          )}
          {user && (
            <Link
              href="/notifications"
              className="nav-with-badge"
              aria-label="Уведомления"
              title="Уведомления"
            >
              🔔
              {unreadNotif > 0 && <span className="nav-unread">{unreadNotif}</span>}
            </Link>
          )}
        </nav>

        <form action="/search" method="get" className="search-box">
          <input type="search" name="q" placeholder="Поиск: название, автор, персонаж…" />
        </form>

        <div className="header-actions">
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
