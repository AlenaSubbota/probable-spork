import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
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
  const path = req.nextUrl.pathname;

  // Публично без авторизации
  if (
    path.startsWith('/login') ||
    path.startsWith('/_next') ||
    path.startsWith('/auth')
  ) {
    return res;
  }

  if (!user) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // Эти пути доступны любому залогиненному пользователю
  if (path.startsWith('/translator/apply')) {
    return res;
  }

  const { data: profile } = await sb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  const role = profile?.role;

  // В бета-режиме всё доступно только переводчикам и админу.
  // Обычные пользователи → форма заявки.
  if (!role || !['admin', 'translator'].includes(role)) {
    return NextResponse.redirect(new URL('/translator/apply', req.url));
  }

  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
