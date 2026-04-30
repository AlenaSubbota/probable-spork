import Link from 'next/link';
import { getCoverUrl } from '@/lib/format';

export interface RecommendedNovel {
  firebase_id: string;
  title: string;
  cover_url: string | null;
  average_rating: number | null;
  match_reason: string;
}

interface Props {
  items: RecommendedNovel[];
  /** Новелла, на основе которой подобраны рекомендации. Для подписи. */
  basedOnTitle: string | null;
}

// «Тебе должно зайти» — рекомендации для залогиненных, у кого есть
// история чтения. Используем коллаборативную фильтрацию через RPC
// (ищем читателей, которые поставили высокий рейтинг той же новелле,
// что и юзер, и смотрим, что они ещё любят).

export default function PersonalRecs({ items, basedOnTitle }: Props) {
  if (items.length === 0) return null;

  return (
    <section className="container section">
      <div className="section-head">
        <h2>Тебе должно зайти</h2>
        {basedOnTitle && (
          <span className="more" style={{ cursor: 'default' }}>
            похоже на «{basedOnTitle}»
          </span>
        )}
      </div>
      <div className="recs-grid">
        {items.map((n) => {
          const cover = getCoverUrl(n.cover_url);
          return (
            <Link
              key={n.firebase_id}
              href={`/novel/${n.firebase_id}`}
              className="recs-card"
            >
              <div className="recs-cover">
                {cover ? (
                  <img src={cover} alt="" />
                ) : (
                  <div className="placeholder p1">{n.title}</div>
                )}
                {n.average_rating && n.average_rating > 0 && (
                  <span className="recs-rating">★ {n.average_rating.toFixed(1)}</span>
                )}
              </div>
              <div className="recs-title">{n.title}</div>
              <div className="recs-reason">{n.match_reason}</div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
