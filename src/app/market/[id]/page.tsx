import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { timeAgo } from '@/lib/format';
import {
  ROLE_META,
  COMPENSATION_META,
  LISTING_STATUS_META,
  APP_STATUS_META,
  type MarketplaceRole,
  type Compensation,
  type ListingStatus,
  type ApplicationStatus,
} from '@/lib/marketplace';
import ApplyForm from './ApplyForm';
import ApplicationsManager from './ApplicationsManager';
import WithdrawButton from './WithdrawButton';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ListingDetailPage({ params }: PageProps) {
  const { id } = await params;
  const listingId = parseInt(id, 10);
  if (!Number.isFinite(listingId)) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: listing } = await supabase
    .from('marketplace_listings_view')
    .select('*')
    .eq('id', listingId)
    .maybeSingle();

  if (!listing) notFound();

  const role = listing.role as MarketplaceRole;
  const compensation = listing.compensation as Compensation;
  const status = listing.status as ListingStatus;
  const isAuthor = user?.id === listing.author_id;
  const authorName = (listing.author_name as string | null) ?? 'Переводчик';
  const authorInitial = authorName.trim().charAt(0).toUpperCase() || '?';

  // Свой отклик (если уже есть)
  type MyApp = { id: number; status: ApplicationStatus; message: string | null };
  let myApplication: MyApp | null = null;
  if (user && !isAuthor) {
    const { data } = await supabase
      .from('marketplace_applications')
      .select('id, status, message')
      .eq('listing_id', listingId)
      .eq('applicant_id', user.id)
      .maybeSingle();
    myApplication = (data ?? null) as MyApp | null;
  }

  // Список откликов (только для автора)
  let applications: Array<{
    id: number;
    applicant_id: string;
    message: string | null;
    status: ApplicationStatus;
    portfolio_url: string | null;
    created_at: string;
    applicant_name: string | null;
    applicant_avatar: string | null;
    applicant_slug: string | null;
  }> = [];
  if (isAuthor) {
    const { data } = await supabase
      .from('marketplace_applications_view')
      .select('*')
      .eq('listing_id', listingId)
      .order('created_at', { ascending: false });
    applications = (data ?? []) as typeof applications;
  }

  const authorHref = listing.author_slug
    ? `/t/${listing.author_slug as string}`
    : `/u/${listing.author_id as string}`;

  return (
    <main className="container section" style={{ maxWidth: 820 }}>
      <div className="admin-breadcrumbs">
        <Link href="/market">Маркетплейс</Link>
        <span>/</span>
        <span>Объявление</span>
      </div>

      <article className="listing-detail">
        <header className="listing-detail-head">
          <Link href={authorHref} className="listing-detail-author">
            <div className="market-card-avatar">
              {listing.author_avatar ? (
                <img src={listing.author_avatar as string} alt="" />
              ) : (
                <span>{authorInitial}</span>
              )}
            </div>
            <div>
              <div className="listing-detail-author-name">{authorName}</div>
              <div className="listing-detail-meta">
                {timeAgo(listing.created_at as string)}
              </div>
            </div>
          </Link>
          <span className={`listing-status ${LISTING_STATUS_META[status].className}`}>
            {LISTING_STATUS_META[status].label}
          </span>
        </header>

        <div className="listing-detail-role">
          <span aria-hidden="true">{ROLE_META[role].emoji}</span>
          <span className="listing-detail-role-label">{ROLE_META[role].label}</span>
          <span className="listing-detail-role-desc">{ROLE_META[role].description}</span>
        </div>

        <h1 className="listing-detail-title">{listing.title as string}</h1>

        {listing.novel_title && (
          <div className="listing-detail-novel">
            По новелле:{' '}
            <Link
              href={`/novel/${listing.novel_firebase_id as string}`}
              className="more"
            >
              «{listing.novel_title as string}»
            </Link>
          </div>
        )}

        <p className="listing-detail-description">
          {listing.description as string}
        </p>

        <div className="listing-detail-compensation">
          <span className="listing-detail-comp-icon">💰</span>
          <div>
            <div className="listing-detail-comp-label">
              {COMPENSATION_META[compensation].label}
            </div>
            {listing.compensation_note && (
              <div className="listing-detail-comp-note">
                {listing.compensation_note as string}
              </div>
            )}
          </div>
        </div>

        {/* Блок действий */}
        {!user && (
          <div className="listing-detail-cta">
            <Link href={`/login?next=/market/${listingId}`} className="btn btn-primary">
              Войти, чтобы откликнуться
            </Link>
          </div>
        )}

        {user && isAuthor && (
          <div className="listing-detail-cta">
            <Link href={`/market/${listingId}/edit`} className="btn btn-ghost">
              ✎ Редактировать
            </Link>
          </div>
        )}

        {user && !isAuthor && status === 'open' && (
          <div className="listing-detail-cta">
            {myApplication ? (
              <div className="listing-my-application">
                <div className="listing-my-application-head">
                  Ты уже откликнулся(лась).{' '}
                  <span
                    className={`app-status ${APP_STATUS_META[myApplication.status].className}`}
                  >
                    {APP_STATUS_META[myApplication.status].label}
                  </span>
                </div>
                {myApplication.message && (
                  <p className="listing-my-application-text">
                    {myApplication.message}
                  </p>
                )}
                {myApplication.status === 'pending' && (
                  <WithdrawButton applicationId={myApplication.id} />
                )}
              </div>
            ) : (
              <ApplyForm listingId={listingId} />
            )}
          </div>
        )}

        {user && !isAuthor && status !== 'open' && (
          <div className="listing-detail-cta">
            <div className="empty-state" style={{ padding: 18 }}>
              <p>Объявление закрыто — отклики больше не принимаются.</p>
            </div>
          </div>
        )}
      </article>

      {/* Отклики — только автору */}
      {isAuthor && (
        <ApplicationsManager
          applications={applications}
          listingId={listingId}
        />
      )}
    </main>
  );
}
