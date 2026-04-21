import Link from 'next/link';
import { getCoverUrl, timeAgo } from '@/lib/format';

export interface ForgottenItem {
  firebase_id: string;
  novel_id: number;
  title: string;
  cover_url: string | null;
  chapterNumber: number;
  totalChapters: number;
  lastReadAt: string;
  daysForgotten: number;
}

interface Props {
  items: ForgottenItem[];
}

export default function ForgottenNovels({ items }: Props) {
  if (items.length === 0) return null;

  return (
    <section className="container section">
      <div className="section-head">
        <h2>Забытое на полпути</h2>
        <span className="more" style={{ cursor: 'default' }}>
          Возможно, пора вернуться
        </span>
      </div>

      <div>
        {items.map((item) => {
          const cover = getCoverUrl(item.cover_url);
          const progressPct =
            item.totalChapters > 0
              ? Math.min(100, Math.round((item.chapterNumber / item.totalChapters) * 100))
              : 0;

          return (
            <Link
              key={item.firebase_id}
              href={`/novel/${item.firebase_id}/${item.chapterNumber}`}
              className="forgotten-row"
            >
              <div className="mini-cover">
                {cover ? (
                  <img
                    src={cover}
                    alt={item.title}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <div className="placeholder p1" style={{ fontSize: 10 }}>
                    {item.title}
                  </div>
                )}
              </div>

              <div className="body">
                <div className="title">{item.title}</div>
                <div className="sub">
                  Остановились на главе {item.chapterNumber} из {item.totalChapters}
                  {' · '}
                  {progressPct}% пройдено
                </div>
                <div className="progress" aria-hidden="true">
                  <span style={{ width: `${progressPct}%` }} />
                </div>
                <div className="dust">Пауза {timeAgo(item.lastReadAt)}</div>
              </div>

              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '0 14px', height: 36 }}
              >
                Продолжить →
              </button>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
