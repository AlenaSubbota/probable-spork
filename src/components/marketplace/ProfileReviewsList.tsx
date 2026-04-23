import Link from 'next/link';
import { timeAgo } from '@/lib/format';
import ReviewStars from './ReviewStars';
import { ROLE_META, type MarketplaceRole } from '@/lib/marketplace';

interface Review {
  id: number;
  listing_id: number;
  author_id: string;
  rating: number;
  text: string | null;
  created_at: string;
  author_name: string | null;
  author_avatar: string | null;
  author_slug: string | null;
  listing_title: string | null;
  listing_role: string | null;
}

interface Props {
  reviews: Review[];
  avgRating: number;
  count: number;
}

// Блок «Отзывы» на странице профиля. Показываем до 10 последних.
export default function ProfileReviewsList({ reviews, avgRating, count }: Props) {
  if (reviews.length === 0) return null;

  return (
    <section className="profile-reviews">
      <div className="section-head">
        <h2>Отзывы о работе</h2>
        <div className="profile-reviews-summary">
          <ReviewStars value={Math.round(avgRating)} size={16} />
          <span className="profile-reviews-summary-value">{avgRating.toFixed(1)}</span>
          <span className="profile-reviews-summary-count">
            · {count} {pluralRu(count, 'отзыв', 'отзыва', 'отзывов')}
          </span>
        </div>
      </div>

      <div className="profile-reviews-list">
        {reviews.map((r) => {
          const href = r.author_slug ? `/t/${r.author_slug}` : `/u/${r.author_id}`;
          const initial = (r.author_name ?? '?').trim().charAt(0).toUpperCase() || '?';
          const role = (r.listing_role ?? 'other') as MarketplaceRole;
          return (
            <article key={r.id} className="review-card">
              <header className="review-card-head">
                <Link href={href} className="review-card-author">
                  <div className="market-card-avatar">
                    {r.author_avatar ? <img src={r.author_avatar} alt="" /> : <span>{initial}</span>}
                  </div>
                  <div>
                    <div className="review-card-name">{r.author_name ?? 'Пользователь'}</div>
                    <div className="review-card-time">
                      {timeAgo(r.created_at)}
                      {r.listing_title && (
                        <>
                          {' · '}
                          <Link href={`/market/${r.listing_id}`} className="more">
                            {ROLE_META[role].short}: {r.listing_title.slice(0, 40)}
                          </Link>
                        </>
                      )}
                    </div>
                  </div>
                </Link>
                <ReviewStars value={r.rating} size={16} />
              </header>
              {r.text && <p className="review-card-text">{r.text}</p>}
            </article>
          );
        })}
      </div>
    </section>
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
