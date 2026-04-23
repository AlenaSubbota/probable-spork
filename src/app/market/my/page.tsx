import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { timeAgo } from '@/lib/format';
import {
  ROLE_META,
  LISTING_STATUS_META,
  APP_STATUS_META,
  type MarketplaceRole,
  type ListingStatus,
  type ApplicationStatus,
} from '@/lib/marketplace';

export const metadata = { title: 'Мои объявления — Маркетплейс' };

export default async function MyMarketPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/market/my');

  const { data: myListings } = await supabase
    .from('marketplace_listings_view')
    .select('*')
    .eq('author_id', user.id)
    .order('created_at', { ascending: false });

  const { data: myApps } = await supabase
    .from('marketplace_applications')
    .select('id, listing_id, message, status, created_at')
    .eq('applicant_id', user.id)
    .order('created_at', { ascending: false });

  // Листинги на которые откликался
  const appListingIds = Array.from(new Set((myApps ?? []).map((a) => a.listing_id)));
  const { data: appListings } = appListingIds.length
    ? await supabase
        .from('marketplace_listings_view')
        .select('id, title, role, status, author_name, author_slug, author_id')
        .in('id', appListingIds)
    : { data: [] as Array<{
        id: number;
        title: string;
        role: string;
        status: string;
        author_name: string | null;
        author_slug: string | null;
        author_id: string;
      }> };
  const appListingMap = new Map(
    (appListings ?? []).map((l) => [l.id, l])
  );

  return (
    <main className="container section" style={{ maxWidth: 900 }}>
      <div className="admin-breadcrumbs">
        <Link href="/market">Маркетплейс</Link>
        <span>/</span>
        <span>Мои объявления</span>
      </div>

      <header className="market-head">
        <div>
          <h1>Мои объявления и отклики</h1>
          <p className="market-head-sub">
            Что я разместил(а) и куда откликался(ась).
          </p>
        </div>
        <Link href="/market/new" className="btn btn-primary">
          ＋ Новое объявление
        </Link>
      </header>

      <section className="market-section">
        <h2>Мои объявления</h2>
        {myListings && myListings.length > 0 ? (
          <div className="market-list">
            {myListings.map((l) => {
              const role = l.role as MarketplaceRole;
              const status = l.status as ListingStatus;
              return (
                <Link
                  key={l.id as number}
                  href={`/market/${l.id}`}
                  className="market-card"
                >
                  <div className="market-card-head">
                    <div className="market-card-author-block">
                      <div className="market-card-meta">
                        {timeAgo(l.created_at as string)}
                        {l.novel_title && (
                          <>
                            <span className="market-card-sep">·</span>
                            <span>«{l.novel_title as string}»</span>
                          </>
                        )}
                      </div>
                    </div>
                    <span
                      className={`listing-status ${LISTING_STATUS_META[status].className}`}
                    >
                      {LISTING_STATUS_META[status].label}
                    </span>
                  </div>
                  <div className="market-card-role">
                    <span aria-hidden="true">{ROLE_META[role].emoji}</span>
                    {ROLE_META[role].label}
                  </div>
                  <h3 className="market-card-title">{l.title as string}</h3>
                  <div className="market-card-foot">
                    <span className="market-card-applications">
                      {(l.application_count ?? 0) === 0
                        ? 'Откликов пока нет'
                        : `${l.application_count} ${plural(
                            Number(l.application_count),
                            'отклик',
                            'отклика',
                            'откликов',
                          )}`}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <p>Пока ничего не размещал(а).</p>
            <Link href="/market/new" className="btn btn-primary">
              Разместить первое объявление
            </Link>
          </div>
        )}
      </section>

      <section className="market-section">
        <h2>Куда откликался(ась)</h2>
        {myApps && myApps.length > 0 ? (
          <div className="market-list">
            {myApps.map((a) => {
              const l = appListingMap.get(a.listing_id);
              const appStatus = a.status as ApplicationStatus;
              return (
                <div key={a.id} className="market-card">
                  <div className="market-card-head">
                    <div className="market-card-author-block">
                      <div className="market-card-meta">
                        Отклик от {timeAgo(a.created_at)}
                      </div>
                    </div>
                    <span className={`app-status ${APP_STATUS_META[appStatus].className}`}>
                      {APP_STATUS_META[appStatus].label}
                    </span>
                  </div>
                  {l ? (
                    <>
                      <div className="market-card-role">
                        <span aria-hidden="true">
                          {ROLE_META[l.role as MarketplaceRole].emoji}
                        </span>
                        {ROLE_META[l.role as MarketplaceRole].label}
                      </div>
                      <h3 className="market-card-title">
                        <Link href={`/market/${l.id}`} className="more">
                          {l.title}
                        </Link>
                      </h3>
                      <div className="market-card-meta">
                        Автор: {l.author_name ?? 'Переводчик'}
                      </div>
                    </>
                  ) : (
                    <p className="market-card-description">[листинг недоступен]</p>
                  )}
                  {a.message && (
                    <p className="market-card-description">{a.message}</p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <p>Ещё никуда не откликался(ась).</p>
            <Link href="/market" className="btn btn-primary">
              К маркетплейсу
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
