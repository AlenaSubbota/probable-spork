import Link from 'next/link';
import { createClient } from '@/utils/supabase/server';

export default async function SiteHeader() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let userName: string | null = null;
  let role: string = 'user';

  if (user) {
    const { data } = await supabase
      .from('profiles')
      .select('user_name, role')
      .eq('id', user.id)
      .maybeSingle();
    userName = data?.user_name ?? null;
    role = data?.role ?? 'user';
  }

  const isTranslator = role === 'translator' || role === 'admin';

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
            <>
              {isTranslator ? (
                <>
                  <Link href="/admin/novels/new" className="btn btn-ghost">
                    + Новелла
                  </Link>
                  <Link href="/admin" className="btn btn-ghost">
                    Админка
                  </Link>
                </>
              ) : (
                <Link href="/translator/apply" className="btn btn-ghost">
                  Стать переводчиком
                </Link>
              )}
              <Link href="/profile" className="btn btn-primary">
                {userName ?? 'Профиль'}
              </Link>
            </>
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
