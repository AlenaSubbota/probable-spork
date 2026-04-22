import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/utils/supabase/server';

// OAuth callback для Google (и любых других Supabase-OAuth провайдеров,
// которые мы решим добавить). Supabase после успешной авторизации
// возвращает пользователя сюда с ?code=<auth_code>.
//
// Мы обмениваем code на session серверно — тогда Supabase SSR client
// записывает cookie на домене chaptify.ru (а не на tene.fun, где живёт
// сам Supabase). После этого SSR на главной корректно видит юзера.
//
// Без этого роута сессия живёт только в localStorage на клиенте, и
// SSR-шапка рендерится с user=null, показывая «Войти / Регистрация»
// залогиненному пользователю.

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Абсолютный redirect на origin текущего запроса (chaptify.ru),
      // чтобы уйти на страницу с уже установленной куки.
      return NextResponse.redirect(`${origin}${next}`);
    }
    // Ошибка обмена — шлём на login с текстом ошибки
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`
    );
  }

  // Пришли без code — что-то пошло не так у провайдера
  return NextResponse.redirect(`${origin}/login?error=oauth_no_code`);
}
