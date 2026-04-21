import Link from 'next/link';
import { createClient } from '@/utils/supabase/server';

export default async function SiteHeader() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let userName: string | null = null;
  if (user) {
    const { data } = await supabase
      .from('profiles')
      .select('user_name')
      .eq('id', user.id)
      .maybeSingle();
    userName = data?.user_name ?? null;
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
        </nav>

        <div className="search-box">
          <input type="search" placeholder="Поиск новеллы..." />
        </div>

        <div className="header-actions">
          {user ? (
            <Link href="/profile" className="btn btn-ghost">
              {userName ?? 'Профиль'}
            </Link>
          ) : (
            <Link href="/login" className="btn btn-primary">
              Войти
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
