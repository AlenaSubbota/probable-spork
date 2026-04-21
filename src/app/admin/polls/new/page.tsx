import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import PollForm from '@/components/admin/PollForm';

export const metadata = { title: 'Новый опрос — Chaptify' };

export default async function NewPollPage() {
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
        <Link href="/admin/polls">Опросы</Link>
        <span>/</span>
        <span>Новый</span>
      </div>

      <h1>Новый опрос</h1>
      <p style={{ color: 'var(--ink-mute)', marginBottom: 24 }}>
        Появится на главной как блок для голосования. Один человек — один голос;
        можно поменять свой выбор в любой момент.
      </p>

      <PollForm mode="create" />
    </main>
  );
}
