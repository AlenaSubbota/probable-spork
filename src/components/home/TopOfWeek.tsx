import Link from 'next/link';
import { getCoverUrl } from '@/lib/format';

export interface TopOfWeekItem {
  firebase_id: string;
  title: string;
  cover_url: string | null;
  weekly_avg: number;
  weekly_votes: number;
}

interface Props {
  items: TopOfWeekItem[];
}

// Топ недели по рейтингу. В отличие от «На волне» (по скорости глав),
// этот блок — про качество: новеллы, которые на этой неделе чаще всего
// получали 4–5 звёзд от читателей. Дополняет, не дублирует.

export default function TopOfWeek({ items }: Props) {
  if (items.length === 0) return null;

  return (
    <section className="container section">
      <div className="section-head">
        <h2>
          <span className="top-week-mark" aria-hidden="true">★</span>
          Топ недели
        </h2>
        <Link href="/catalog?sort=rating" className="more">
          Все по рейтингу →
        </Link>
      </div>
      <ol className="top-week-list">
        {items.map((n, i) => {
          const cover = getCoverUrl(n.cover_url);
          return (
            <li key={n.firebase_id} className="top-week-item">
              <Link href={`/novel/${n.firebase_id}`} className="top-week-link">
                <span className="top-week-rank">{i + 1}</span>
                <span className="top-week-cover">
                  {cover ? (
                    <img src={cover} alt="" />
                  ) : (
                    <span className="placeholder p1">{n.title}</span>
                  )}
                </span>
                <span className="top-week-body">
                  <span className="top-week-title">{n.title}</span>
                  <span className="top-week-stats">
                    <span className="top-week-rating">★ {n.weekly_avg.toFixed(1)}</span>
                    <span className="top-week-sep">·</span>
                    <span className="top-week-votes">{n.weekly_votes} оценок за неделю</span>
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
