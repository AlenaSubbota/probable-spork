import Link from 'next/link';
import { getCoverUrl } from '@/lib/format';
 
export interface ShelfItem {
  firebase_id: string;
  title: string;
  cover_url: string | null;
}
 
interface Props {
  items: ShelfItem[];
  totalCount: number;
}
 
export default function MyShelfStrip({ items, totalCount }: Props) {
  if (items.length === 0) return null;
 
  return (
    <section className="container section" style={{ paddingTop: 12, paddingBottom: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '14px 18px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>
          Твоя полка <span style={{ color: 'var(--ink-mute)', fontWeight: 400 }}>({totalCount})</span>
        </div>
        <div className="shelf-strip" style={{ flex: 1 }}>
          {items.map((item) => {
            const cover = getCoverUrl(item.cover_url);
            return (
              <Link
                key={item.firebase_id}
                href={`/novel/${item.firebase_id}`}
                className="shelf-thumb"
                title={item.title}
              >
                {cover ? (
                  <img src={cover} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div className="placeholder p1" style={{ fontSize: 9 }}>
                    {item.title}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
        <Link href="/profile" className="more" style={{ whiteSpace: 'nowrap' }}>
          Все →
        </Link>
      </div>
    </section>
  );
}