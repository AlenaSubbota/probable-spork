import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import NewsForm from '@/components/admin/NewsForm';

export const metadata = { title: 'Новая новость — Chaptify' };

export default async function NewNewsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  const p = profile as { role?: string; is_admin?: boolean } | null;
  const isAdmin = p?.is_admin === true || p?.role === 'admin';
  if (!isAdmin) redirect('/admin');

  return (
    <main className="container admin-page">
      <div className="admin-breadcrumbs">
        <Link href="/admin">Админка</Link>
        <span>/</span>
        <Link href="/admin/news">Новости</Link>
        <span>/</span>
        <span>Новая</span>
      </div>

      <h1>Новая новость</h1>
      <p style={{ color: 'var(--ink-mute)', marginBottom: 24 }}>
        Попадёт в ленту главной страницы и раздел «Новости». Закрепи, если хочешь всплыть наверх.
      </p>

      <NewsForm mode="create" />
    </main>
  );
}
