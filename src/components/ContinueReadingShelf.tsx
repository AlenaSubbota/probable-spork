import Link from 'next/link';
import { getCoverUrl, timeAgo } from '@/lib/format';
 
export interface ContinueItem {
  firebase_id: string;
  title: string;
  cover_url: string | null;
  chapterNumber: number | null;
  totalChapters: number | null;
  lastReadAt: string;
}
 
interface Props {
  items: ContinueItem[];
}
 
export default function ContinueReadingShelf({ items }: Props) {
  if (items.length === 0) return null;
 
  return (
    <section className="container section">
      <div className="section-head">
        <h2>Продолжить чтение</h2>
        <Link href="/profile" className="more">
          Вся библиотека →
        </Link>
      </div>
 
      <div className="shelf-scroll">
        {items.map((item) => {
          const cover = getCoverUrl(item.cover_url);
          const target =
            item.chapterNumber != null
              ? `/novel/${item.firebase_id}/${item.chapterNumber}`
              : `/novel/${item.firebase_id}`;
          const progressPct =
            item.chapterNumber && item.totalChapters
              ? Math.min(100, Math.round((item.chapterNumber / item.totalChapters) * 100))
              : null;
 
          return (
            <Link key={item.firebase_id} href={target} className="continue-card">
              <div className="mini-cover">
                {cover ? (
                  <img src={cover} alt={item.title} />
                ) : (
                  <div className="placeholder p1" style={{ fontSize: 10 }}>
                    {item.title}
                  </div>
                )}
              </div>
              <div className="body">
                <div className="title">{item.title}</div>
                <div className="meta">
                  {item.chapterNumber != null && item.totalChapters
                    ? `Глава ${item.chapterNumber} из ${item.totalChapters}`
                    : item.chapterNumber != null
                    ? `Глава ${item.chapterNumber}`
                    : 'Продолжить'}
                </div>
                {progressPct != null && (
                  <div className="progress" aria-hidden="true">
                    <span style={{ width: `${progressPct}%` }} />
                  </div>
                )}
                <div className="meta" style={{ marginTop: 4 }}>
                  {timeAgo(item.lastReadAt)}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}