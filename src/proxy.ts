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
  let res = NextResponse.next({ request: req });
  const path = req.nextUrl.pathname;
  const code = req.nextUrl.searchParams.get('code');

  // OAuth failsafe: Supabase иногда усекает redirect_to до origin
  // и возвращает ?code=... на корень (или любой путь) вместо
  // /auth/callback. Если видим ?code= на публичной странице —
  // перекидываем на наш callback-page, он сделает exchange на клиенте.
  // Важно: используем req.nextUrl.clone() чтобы сохранить внешний host
  // (chaptify.ru), а не внутренний docker-hostname из req.url.
  if (code && !path.startsWith('/auth/callback')) {
    const callbackUrl = req.nextUrl.clone();
    callbackUrl.pathname = '/auth/callback';
    callbackUrl.searchParams.set('code', code);
    const next = req.nextUrl.searchParams.get('next');
    if (next) callbackUrl.searchParams.set('next', next);
    // чистим вообще все остальные query, на callback их не надо
    return NextResponse.redirect(callbackUrl);
  }

  // Быстрый выход для ассетов — там session не нужна
  if (path.startsWith('/_next') || path.startsWith('/favicon')) {
    return res;
  }

  // КРИТИЧНО: supabase-auth refresh делаем в прокси на КАЖДОМ запросе,
  // даже публичных. Иначе server component (SiteHeader и др.) сам
  // триггерит refresh через fetch → Safari desktop с ITP режет ответ
  // на установку новых cookies → getUser() висит → RSC-stream не
  // закрывается → пользователь видит «бесконечную загрузку».
  // В прокси refresh отрабатывает в контексте браузерной навигации,
  // cookies ставятся в response.headers как first-party и ITP их
  // принимает. Канонический паттерн из @supabase/ssr docs.
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => {
          list.forEach((c) => req.cookies.set(c.name, c.value));
          res = NextResponse.next({ request: req });
          list.forEach((c) => res.cookies.set(c.name, c.value, c.options));
        },
      },
    }
  );
  // getUser() (а не getSession) — именно он форсит refresh и выставляет
  // обновлённые cookies через setAll выше.
  const { data: { user } } = await sb.auth.getUser();

  // Публичные страницы — после refresh'а пропускаем без проверок.
  // Для зарегистрированных просто доставляем свежие cookies;
  // анонимам — тоже res без изменений.
  const isAuthPath =
    path === '/login' ||
    path.startsWith('/login/') ||
    path === '/register' ||
    path.startsWith('/register/') ||
    path.startsWith('/auth');
  if (isAuthPath) return res;

  const needsAuth = isPrefixMatch(path, PROTECTED_PREFIXES);
  const needsAdmin = isPrefixMatch(path, ADMIN_PREFIXES);

  if (!needsAuth) return res;

  if (!user) {
    // Неавторизованный на защищённой странице — на логин с returnUrl,
    // чтобы после входа вернулся ровно туда, куда хотел.
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', path + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  // Админ-роуты требуют role translator/admin
  if (needsAdmin) {
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
  // Исключаем статику, картинки и шрифты — там session обновлять
  // не нужно и лишний supabase-round-trip только тормозит.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf)$).*)',
  ],
};
