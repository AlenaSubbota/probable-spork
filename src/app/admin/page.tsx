import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCoverUrl } from '@/lib/format';
import { MODERATION_LABELS, TRANSLATION_STATUS_LABELS } from '@/lib/admin';
import AdminApplications from './AdminApplications';

export default async function AdminDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  const p = profile as {
    role?: string;
    is_admin?: boolean;
    translator_slug?: string | null;
    translator_display_name?: string | null;
  } | null;

  const role = p?.role;
  const isAdminLegacy = p?.is_admin === true;
  const isTranslator = isAdminLegacy || role === 'translator' || role === 'admin';

  if (!isTranslator) {
    redirect('/translator/apply');
  }

  const isAdmin = isAdminLegacy || role === 'admin';

  // Мои новеллы (или все для админа)
  let novelsQuery = supabase
    .from('novels_view')
    .select('id, firebase_id, title, cover_url, chapter_count, is_completed, translator_id, moderation_status, translation_status, latest_chapter_published_at');
  if (!isAdmin) {
    novelsQuery = novelsQuery.eq('translator_id', user.id);
  }
  const { data: novels } = await novelsQuery.order('latest_chapter_published_at', { ascending: false, nullsFirst: false });

  // Заявки в переводчики (только для админа)
  let applications: Array<{
    id: number;
    user_id: string;
    motivation: string;
    portfolio_url: string | null;
    desired_slug: string | null;
    languages: string[] | null;
    status: string;
    created_at: string;
  }> = [];
  if (isAdmin) {
    const { data } = await supabase
      .from('translator_applications')
      .select('id, user_id, motivation, portfolio_url, desired_slug, languages, status, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    applications = data ?? [];
  }

  return (
    <main className="container admin-page">
      <header className="admin-head">
        <div>
          <h1>
            Админка
            {!isAdmin && p?.translator_display_name && (
              <span className="admin-head-who"> · {p.translator_display_name}</span>
            )}
          </h1>
          <p className="admin-head-sub">
            {isAdmin ? 'Управляй всеми новеллами и заявками.' : 'Твои новеллы и главы.'}
          </p>
        </div>
        <Link href="/admin/novels/new" className="btn btn-primary">
          + Новелла
        </Link>
      </header>

      <div className="admin-grid">
        <section>
          <div className="section-head">
            <h2>{isAdmin ? 'Все новеллы' : 'Мои новеллы'}</h2>
            <span className="more" style={{ cursor: 'default' }}>
              {novels?.length ?? 0} шт.
            </span>
          </div>

          {!novels || novels.length === 0 ? (
            <div className="empty-state">
              <p>Пока ни одной новеллы.</p>
              <Link href="/admin/novels/new" className="btn btn-primary">
                Добавить первую
              </Link>
            </div>
          ) : (
            <div className="admin-novel-list">
              {novels.map((n) => (
                <div key={n.id} className="admin-novel-row">
                  <div className="admin-novel-cover">
                    {n.cover_url ? (
                      <img src={getCoverUrl(n.cover_url) ?? ''} alt={n.title} />
                    ) : (
                      <div className="placeholder p1" style={{ fontSize: 10 }}>
                        {n.title}
                      </div>
                    )}
                  </div>
                  <div className="admin-novel-body">
                    <Link
                      href={`/novel/${n.firebase_id}`}
                      className="admin-novel-title"
                    >
                      {n.title}
                    </Link>
                    <div className="admin-novel-meta">
                      {n.chapter_count ?? 0} гл. ·{' '}
                      {MODERATION_LABELS[(n.moderation_status ?? 'published') as keyof typeof MODERATION_LABELS]} ·{' '}
                      {TRANSLATION_STATUS_LABELS[(n.translation_status ?? 'ongoing') as keyof typeof TRANSLATION_STATUS_LABELS]}
                    </div>
                  </div>
                  <div className="admin-novel-actions">
                    <Link
                      href={`/admin/novels/${n.firebase_id}/chapters/new`}
                      className="btn btn-primary"
                      style={{ height: 34 }}
                    >
                      + Глава
                    </Link>
                    <Link
                      href={`/admin/novels/${n.firebase_id}/edit`}
                      className="btn btn-ghost"
                      style={{ height: 34 }}
                    >
                      Редактировать
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {isAdmin && (
          <AdminApplications applications={applications} />
        )}
      </div>
    </main>
  );
}
