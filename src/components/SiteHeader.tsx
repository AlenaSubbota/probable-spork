import Link from 'next/link';
import { createClient } from '@/utils/supabase/server';

export default async function SiteHeader() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let userName: string | null = null;
  let isTranslator = false;

  if (user) {
    // select('*') чтобы работать без миграции 001 (legacy is_admin) и с ней (role)
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();
    if (data) {
      const p = data as { user_name?: string | null; role?: string; is_admin?: boolean };
      userName = p.user_name ?? null;
      isTranslator =
        p.is_admin === true || p.role === 'translator' || p.role === 'admin';
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
        </nav>

        <form action="/search" method="get" className="search-box">
          <input type="search" name="q" placeholder="Поиск: название, автор, персонаж…" />
        </form>

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
