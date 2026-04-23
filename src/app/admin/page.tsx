import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCoverUrl } from '@/lib/format';
import {
  MODERATION_LABELS,
  MODERATION_TONE,
  TRANSLATION_STATUS_LABELS,
  type ModerationStatus,
} from '@/lib/admin';
import AdminApplications from './AdminApplications';
import SubmitForReviewButton from '@/components/admin/SubmitForReviewButton';

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
    .select('id, firebase_id, title, cover_url, chapter_count, is_completed, translator_id, moderation_status, translation_status, latest_chapter_published_at, rejection_reason');
  if (!isAdmin) {
    novelsQuery = novelsQuery.eq('translator_id', user.id);
  }
  const { data: novels } = await novelsQuery.order('latest_chapter_published_at', { ascending: false, nullsFirst: false });

  // Сколько новелл сейчас висит на модерации (только для админа — бейдж в шапке)
  let pendingCount = 0;
  if (isAdmin) {
    const { count } = await supabase
      .from('novels')
      .select('id', { count: 'exact', head: true })
      .eq('moderation_status', 'pending');
    pendingCount = count ?? 0;
  }

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
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/admin/analytics" className="btn btn-ghost">
            Аналитика
          </Link>
          <Link href="/admin/schedule" className="btn btn-ghost">
            📅 Расписание
          </Link>
          <Link href="/admin/payouts" className="btn btn-ghost">
            💳 Настройки выплат
          </Link>
          <Link href="/admin/subscribers" className="btn btn-ghost">
            💌 Подписчики
          </Link>
          {isAdmin && (
            <>
              <Link
                href="/admin/moderation"
                className="btn btn-ghost"
                style={{ position: 'relative' }}
              >
                🛡 Модерация
                {pendingCount > 0 && (
                  <span
                    style={{
                      marginLeft: 6,
                      padding: '1px 7px',
                      background: 'var(--rose)',
                      color: '#fff',
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {pendingCount}
                  </span>
                )}
              </Link>
              <Link href="/admin/all-payouts" className="btn btn-ghost">
                💰 Выплаты переводчикам
              </Link>
              <Link href="/admin/news" className="btn btn-ghost">
                📢 Новости
              </Link>
              <Link href="/admin/polls" className="btn btn-ghost">
                🗳 Опросы
              </Link>
            </>
          )}
          <Link href="/admin/novels/new" className="btn btn-primary">
            + Новелла
          </Link>
        </div>
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
              {novels.map((n) => {
                const status = (n.moderation_status ?? 'published') as ModerationStatus;
                const tone = MODERATION_TONE[status];
                const canSubmit = status === 'draft' || status === 'rejected';
                return (
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
                        <span className={`mod-badge mod-badge--${tone}`}>
                          {MODERATION_LABELS[status]}
                        </span>
                        <span> · {n.chapter_count ?? 0} гл.</span>
                        <span>
                          {' · '}
                          {TRANSLATION_STATUS_LABELS[(n.translation_status ?? 'ongoing') as keyof typeof TRANSLATION_STATUS_LABELS]}
                        </span>
                      </div>
                      {status === 'rejected' && n.rejection_reason && (
                        <div className="admin-novel-reject">
                          <strong>Причина отказа:</strong> {n.rejection_reason}
                        </div>
                      )}
                    </div>
                    <div className="admin-novel-actions">
                      {canSubmit && !isAdmin && (
                        <SubmitForReviewButton novelId={n.id} compact />
                      )}
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
                );
              })}
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
