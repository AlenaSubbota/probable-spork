import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Страницы, для которых нужен вход. Всё остальное публично —
// каталог, новеллы, чтение бесплатных глав, страницы переводчиков, поиск и т.п.
// Так новый посетитель сразу видит сайт, а не упирается в /login.
const PROTECTED_PREFIXES = [
  '/admin',
  '/profile',
  '/bookmarks',
  '/friends',
  '/messages',
  '/notifications',
];

// Страницы, которые доступны любому залогиненному, но внутри /admin требуют
// роль translator/admin. Всё, что в PROTECTED_PREFIXES и не в этом списке,
// гостя просто отправит на /login — а там уже можно решить чем заняться.
const ADMIN_PREFIXES = ['/admin'];

function isPrefixMatch(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (p) => path === p || path.startsWith(p + '/') || path.startsWith(p + '?')
  );
}

export async function proxy(req: NextRequest) {
  const res = NextResponse.next();
  const path = req.nextUrl.pathname;

  // Быстрый выход для ассетов и явно публичных маршрутов
  if (
    path.startsWith('/_next') ||
    path.startsWith('/api') ||
    path.startsWith('/favicon') ||
    path === '/login' ||
    path.startsWith('/login/') ||
    path === '/register' ||
    path.startsWith('/register/') ||
    path.startsWith('/auth')
  ) {
    return res;
  }

  const needsAuth = isPrefixMatch(path, PROTECTED_PREFIXES);
  const needsAdmin = isPrefixMatch(path, ADMIN_PREFIXES);

  // Публичные страницы (каталог, новеллы, главы, профили переводчиков и т.п.)
  // вообще не требуют проверки сессии — проходят мимо Supabase, чтобы и
  // анонимы видели контент.
  if (!needsAuth) {
    return res;
  }

  // Защищённые страницы — проверяем сессию
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => list.forEach((c) => res.cookies.set(c)),
      },
    }
  );
  const { data: { user } } = await sb.auth.getUser();

  if (!user) {
    // Неавторизованный на защищённой странице — на логин с returnUrl,
    // чтобы после входа вернулся ровно туда, куда хотел.
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', path + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  // Админ-роуты требуют role translator/admin
  if (needsAdmin) {
    if (path.startsWith('/admin') && path !== '/admin' &&
        path.startsWith('/admin/moderation')) {
      // модерация — только чистый админ, но проверит сама страница
    }
    const { data: profile } = await sb
      .from('profiles')
      .select('role, is_admin')
      .eq('id', user.id)
      .maybeSingle();

    const p = profile as { role?: string; is_admin?: boolean } | null;
    const isAdminOrTranslator =
      p?.is_admin === true || p?.role === 'admin' || p?.role === 'translator';

    if (!isAdminOrTranslator) {
      return NextResponse.redirect(new URL('/translator/apply', req.url));
    }
  }

  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
