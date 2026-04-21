import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { timeAgo } from '@/lib/format';

export const metadata = { title: 'Опросы · Админка — Chaptify' };

export default async function AdminPollsPage() {
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

  const { data: polls } = await supabase
    .from('polls')
    .select('id, title, is_active, ends_at, created_at')
    .order('is_active', { ascending: false })
    .order('created_at', { ascending: false });

  // Считаем голоса отдельным запросом — дешевле, чем group by в RPC
  const pollIds = (polls ?? []).map((p) => p.id);
  const voteCounts = new Map<number, number>();
  if (pollIds.length > 0) {
    const { data: votes } = await supabase
      .from('poll_votes')
      .select('poll_id')
      .in('poll_id', pollIds);
    for (const v of votes ?? []) {
      voteCounts.set(v.poll_id, (voteCounts.get(v.poll_id) ?? 0) + 1);
    }
  }

  return (
    <main className="container admin-page">
      <div className="admin-breadcrumbs">
        <Link href="/admin">Админка</Link>
        <span>/</span>
        <span>Опросы</span>
      </div>

      <nav className="admin-subtabs">
        <Link href="/admin/news" className="admin-subtab">
          📢 Новости
        </Link>
        <Link href="/admin/polls" className="admin-subtab active">
          🗳 Опросы
        </Link>
      </nav>

      <header className="admin-head">
        <div>
          <h1>Опросы</h1>
          <p className="admin-head-sub">
            Голосования на главной: какую новеллу переводить следующей, куда
            пойти на следующий тимбилдинг, нужны ли платные главы.
          </p>
        </div>
        <Link href="/admin/polls/new" className="btn btn-primary">
          + Опрос
        </Link>
      </header>

      {!polls || polls.length === 0 ? (
        <div className="empty-state">
          <p>Пока ни одного опроса.</p>
          <Link href="/admin/polls/new" className="btn btn-primary">
            Создать первый
          </Link>
        </div>
      ) : (
        <div className="admin-novel-list">
          {polls.map((poll) => {
            const votes = voteCounts.get(poll.id) ?? 0;
            const ended =
              poll.ends_at && new Date(poll.ends_at).getTime() < Date.now();
            return (
              <div key={poll.id} className="admin-novel-row">
                <div
                  className="admin-novel-cover"
                  style={{
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 28,
                  }}
                >
                  🗳
                </div>
                <div className="admin-novel-body">
                  <Link
                    href={`/admin/polls/${poll.id}/edit`}
                    className="admin-novel-title"
                  >
                    {poll.title}
                  </Link>
                  <div className="admin-novel-meta">
                    {votes} {pluralRu(votes, 'голос', 'голоса', 'голосов')} ·{' '}
                    {timeAgo(poll.created_at)}
                    {!poll.is_active && ' · выключен'}
                    {ended && ' · завершён'}
                  </div>
                </div>
                <div className="admin-novel-actions">
                  <Link
                    href={`/admin/polls/${poll.id}/edit`}
                    className="btn btn-ghost"
                    style={{ height: 34 }}
                  >
                    Редактировать
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

function pluralRu(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
