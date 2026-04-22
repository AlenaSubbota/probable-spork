import Link from 'next/link';
import { getCoverUrl } from '@/lib/format';

export interface TrendingNovel {
  firebase_id: string;
  title: string;
  cover_url: string | null;
  new_chapters: number;
  latest_chapter_number: number;
}

interface Props {
  items: TrendingNovel[];
}

// «🔥 На волне» — новеллы с самым высоким темпом выпусков за неделю.
// Сигнал читателю «вот что сейчас активно переводят» — можно смело
// открывать, не застрянет в заморозке.
export default function TrendingNovels({ items }: Props) {
  if (items.length === 0) return null;

  return (
    <section className="container section">
      <div className="section-head">
        <h2>
          <span className="trending-flame" aria-hidden="true">🔥</span>
          На волне
        </h2>
        <span className="more" style={{ cursor: 'default' }}>
          за неделю
        </span>
      </div>
      <div className="trending-grid">
        {items.map((n, i) => {
          const cover = getCoverUrl(n.cover_url);
          return (
            <Link
              key={n.firebase_id}
              href={`/novel/${n.firebase_id}`}
              className="trending-card"
            >
              <div className="trending-rank">#{i + 1}</div>
              <div className="trending-cover">
                {cover ? (
                  <img src={cover} alt="" />
                ) : (
                  <div className="placeholder p1">{n.title}</div>
                )}
                <span className="trending-badge" title="Новых глав за неделю">
                  +{n.new_chapters}
                </span>
              </div>
              <div className="trending-title">{n.title}</div>
              <div className="trending-meta">
                последняя — гл. {n.latest_chapter_number}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
