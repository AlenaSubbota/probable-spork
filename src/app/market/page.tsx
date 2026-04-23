import Link from 'next/link';
import { createClient } from '@/utils/supabase/server';
import { timeAgo } from '@/lib/format';
import {
  ROLE_META,
  COMPENSATION_META,
  LISTING_STATUS_META,
  ALL_ROLES,
  type MarketplaceRole,
  type Compensation,
  type ListingStatus,
} from '@/lib/marketplace';

export const metadata = { title: 'Маркетплейс — Chaptify' };

const PAGE_SIZE = 20;

interface SearchParams {
  role?: string;
  status?: string;
  page?: string;
}

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const activeRole: MarketplaceRole | null =
    (ALL_ROLES as string[]).includes(params.role ?? '')
      ? (params.role as MarketplaceRole)
      : null;
  const activeStatus: ListingStatus =
    params.status === 'closed' || params.status === 'in_progress'
      ? (params.status as ListingStatus)
      : 'open';

  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let q = supabase
    .from('marketplace_listings_view')
    .select('*', { count: 'exact' })
    .eq('status', activeStatus)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (activeRole) q = q.eq('role', activeRole);

  const { data: listings, count } = await q;

  // Счётчики по ролям для сайдбара (внутри текущего status)
  const { data: allForCount } = await supabase
    .from('marketplace_listings')
    .select('role')
    .eq('status', activeStatus);
  const roleCounts: Record<string, number> = {};
  for (const r of allForCount ?? []) {
    roleCounts[r.role as string] = (roleCounts[r.role as string] ?? 0) + 1;
  }

  const buildUrl = (patch: Partial<SearchParams & { _clear?: boolean }>) => {
    const usp = new URLSearchParams();
    const merged = { ...params, ...patch };
    if (merged.role)   usp.set('role', merged.role);
    if (merged.status && merged.status !== 'open') usp.set('status', merged.status);
    // сбрасываем page при изменении фильтра
    if (!patch.page && merged.page && !patch.role && !patch.status) {
      usp.set('page', merged.page);
    }
    if (patch.page) usp.set('page', patch.page);
    const qs = usp.toString();
    return qs ? `/market?${qs}` : '/market';
  };

  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <main className="container section">
      <div className="admin-breadcrumbs">
        <Link href="/">Главная</Link>
        <span>/</span>
        <span>Маркетплейс</span>
      </div>

      <header className="market-head">
        <div>
          <h1>Маркетплейс команды</h1>
          <p className="market-head-sub">
            Ищу редактора, корректора, иллюстратора, бету… Доска объявлений
            вместо беготни по TG-чатам.
          </p>
        </div>
        {user && (
          <Link href="/market/new" className="btn btn-primary">
            ＋ Разместить объявление
          </Link>
        )}
      </header>

      <div className="market-layout">
        {/* Сайдбар с фильтрами */}
        <aside className="market-sidebar">
          <div className="filter-group">
            <div className="filter-group-title">Статус</div>
            <div className="filter-pills">
              {(['open', 'in_progress', 'closed'] as ListingStatus[]).map((s) => (
                <Link
                  key={s}
                  href={buildUrl({ status: s === 'open' ? undefined : s, page: undefined })}
                  className={`filter-pill${activeStatus === s ? ' active' : ''}`}
                >
                  {LISTING_STATUS_META[s].label}
                </Link>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <div className="filter-group-title">Кого ищем</div>
            <div className="market-roles">
              <Link
                href={buildUrl({ role: undefined, page: undefined })}
                className={`market-role-chip${!activeRole ? ' active' : ''}`}
              >
                Все
              </Link>
              {ALL_ROLES.map((r) => (
                <Link
                  key={r}
                  href={buildUrl({ role: r, page: undefined })}
                  className={`market-role-chip${activeRole === r ? ' active' : ''}`}
                >
                  <span className="market-role-emoji" aria-hidden="true">
                    {ROLE_META[r].emoji}
                  </span>
                  <span className="market-role-label">{ROLE_META[r].short}</span>
                  {roleCounts[r] ? (
                    <span className="market-role-count">{roleCounts[r]}</span>
                  ) : null}
                </Link>
              ))}
            </div>
          </div>

          {user && (
            <div className="filter-group">
              <Link href="/market/my" className="btn btn-ghost" style={{ width: '100%' }}>
                Мои объявления и отклики
              </Link>
            </div>
          )}
        </aside>

        {/* Лента объявлений */}
        <section className="market-main">
          {listings && listings.length > 0 ? (
            <div className="market-list">
              {listings.map((l) => (
                <ListingCard key={l.id as number} listing={l} />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <p>
                {activeRole
                  ? `По роли «${ROLE_META[activeRole].label}» пока пусто.`
                  : 'Пока ничего. Будь первым, кто разместит объявление.'}
              </p>
              {user && (
                <Link href="/market/new" className="btn btn-primary">
                  Разместить объявление
                </Link>
              )}
            </div>
          )}

          {totalPages > 1 && (
            <nav className="pagination">
              {page > 1 && (
                <Link
                  href={buildUrl({ page: page > 2 ? String(page - 1) : undefined })}
                  className="page-link"
                >
                  ← Назад
                </Link>
              )}
              <span className="page-ellipsis">
                стр. {page} из {totalPages}
              </span>
              {page < totalPages && (
                <Link
                  href={buildUrl({ page: String(page + 1) })}
                  className="page-link"
                >
                  Вперёд →
                </Link>
              )}
            </nav>
          )}
        </section>
      </div>
    </main>
  );
}

// -----------------------------------------------------------------
// Карточка объявления в ленте
// -----------------------------------------------------------------
function ListingCard({
  listing,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listing: any;
}) {
  const role = listing.role as MarketplaceRole;
  const comp = listing.compensation as Compensation;
  const status = listing.status as ListingStatus;
  const author = listing.author_name as string | null;
  const initial = (author ?? '?').trim().charAt(0).toUpperCase() || '?';
  const appCount = (listing.application_count ?? 0) as number;

  return (
    <Link href={`/market/${listing.id}`} className="market-card">
      <div className="market-card-head">
        <div className="market-card-avatar">
          {listing.author_avatar ? (
            <img src={listing.author_avatar as string} alt="" />
          ) : (
            <span>{initial}</span>
          )}
        </div>
        <div className="market-card-author-block">
          <div className="market-card-author">{author ?? 'Переводчик'}</div>
          <div className="market-card-meta">
            {timeAgo(listing.created_at as string)}
            {listing.novel_title && (
              <>
                <span className="market-card-sep">·</span>
                <span>«{listing.novel_title}»</span>
              </>
            )}
          </div>
        </div>
        <span className={`listing-status ${LISTING_STATUS_META[status].className}`}>
          {LISTING_STATUS_META[status].label}
        </span>
      </div>

      <div className="market-card-role">
        <span aria-hidden="true">{ROLE_META[role].emoji}</span>
        {ROLE_META[role].label}
      </div>

      <h3 className="market-card-title">{listing.title}</h3>

      <p className="market-card-description">
        {(listing.description as string).slice(0, 220)}
        {(listing.description as string).length > 220 && '…'}
      </p>

      <div className="market-card-foot">
        <span className="market-card-comp">
          💰 {COMPENSATION_META[comp].label}
          {listing.compensation_note && (
            <span className="market-card-comp-note"> · {listing.compensation_note}</span>
          )}
        </span>
        <span className="market-card-applications">
          {appCount === 0
            ? 'Ещё нет откликов'
            : `${appCount} ${plural(appCount, 'отклик', 'отклика', 'откликов')}`}
        </span>
      </div>
    </Link>
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
