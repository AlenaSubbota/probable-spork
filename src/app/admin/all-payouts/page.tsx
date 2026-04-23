import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';

// /admin/all-payouts — устарел после мигр. 045.
// Раньше был админский дашборд «сколько кому выплатить в конце месяца».
// В новой модели chaptify не проводит деньги — читатель платит переводчику
// напрямую, и все расчёты уже сделаны вне платформы.
// Оставляем страницу как короткую напоминалку, чтобы старые ссылки
// не вели в 404 — а админ увидит, что делать вместо.
export default async function AllPayoutsRetiredPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_admin')
    .eq('id', user.id)
    .maybeSingle();
  const p = profile as { role?: string; is_admin?: boolean } | null;
  const isAdmin = p?.is_admin === true || p?.role === 'admin';
  if (!isAdmin) redirect('/profile');

  return (
    <main className="container section" style={{ maxWidth: 700 }}>
      <div className="admin-breadcrumbs">
        <Link href="/admin">Админка</Link>
        <span>/</span>
        <span>Выплаты</span>
      </div>

      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: 'var(--font-serif)', margin: '0 0 6px' }}>
          Выплаты переводчикам — больше не актуально
        </h1>
        <p style={{ color: 'var(--ink-soft)', margin: 0, lineHeight: 1.5 }}>
          С миграции 045 chaptify перешёл на <b>per-translator кошельки</b>.
          Читатель платит переводчику напрямую через его Boosty / Tribute /
          карту — chaptify деньги не проводит и не держит. Дашборд «кому
          сколько выплатить» потерял смысл и выпилен.
        </p>
      </header>

      <section className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 8px' }}>Что делать вместо</h3>
        <ul style={{ paddingLeft: 18, lineHeight: 1.7, color: 'var(--ink-soft)' }}>
          <li>
            <b>Как админ:</b> ничего делать не надо. Переводчики принимают
            деньги сами, платят свой налог сами.
          </li>
          <li>
            <b>Как переводчик:</b> настрой способы приёма денег в{' '}
            <Link href="/profile/settings" className="more">/profile/settings</Link>.
            Статистика продаж — в{' '}
            <Link href="/admin/analytics" className="more">/admin/analytics</Link>.
          </li>
          <li>
            <b>Заявки от читателей (подписки / монеты):</b>{' '}
            <Link href="/admin/subscribers" className="more">/admin/subscribers</Link>.
          </li>
        </ul>
      </section>

      <Link href="/admin" className="btn btn-ghost">
        ← В админку
      </Link>
    </main>
  );
}
