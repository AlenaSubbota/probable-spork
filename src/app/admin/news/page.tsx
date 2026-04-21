import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { newsTypeMeta } from '@/lib/news';
import { timeAgo } from '@/lib/format';

export const metadata = { title: 'Новости · Админка — Chaptify' };

export default async function AdminNewsPage() {
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

  const { data: news } = await supabase
    .from('news_posts')
    .select('id, title, type, is_pinned, is_published, created_at, published_at')
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false });

  return (
    <main className="container admin-page">
      <div className="admin-breadcrumbs">
        <Link href="/admin">Админка</Link>
        <span>/</span>
        <span>Новости</span>
      </div>

      <nav className="admin-subtabs">
        <Link href="/admin/news" className="admin-subtab active">
          📢 Новости
        </Link>
        <Link href="/admin/polls" className="admin-subtab">
          🗳 Опросы
        </Link>
      </nav>

      <header className="admin-head">
        <div>
          <h1>Новости</h1>
          <p className="admin-head-sub">Объявления, события, тех. работы — всё, что пользователь видит на главной.</p>
        </div>
        <Link href="/admin/news/new" className="btn btn-primary">
          + Новость
        </Link>
      </header>

      {!news || news.length === 0 ? (
        <div className="empty-state">
          <p>Пока ни одной новости — добавь первую.</p>
          <Link href="/admin/news/new" className="btn btn-primary">
            + Создать
          </Link>
        </div>
      ) : (
        <div className="admin-novel-list">
          {news.map((n) => {
            const meta = newsTypeMeta(n.type);
            return (
              <div key={n.id} className="admin-novel-row">
                <div className="admin-novel-cover" style={{ display: 'grid', placeItems: 'center', fontSize: 28 }}>
                  {meta.emoji}
                </div>
                <div className="admin-novel-body">
                  <Link href={`/news/${n.id}`} className="admin-novel-title">
                    {n.title}
                  </Link>
                  <div className="admin-novel-meta">
                    {meta.label} · {timeAgo(n.published_at ?? n.created_at)}
                    {n.is_pinned && ' · 📌 закреплено'}
                    {!n.is_published && ' · черновик'}
                  </div>
                </div>
                <div className="admin-novel-actions">
                  <Link
                    href={`/admin/news/${n.id}/edit`}
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
