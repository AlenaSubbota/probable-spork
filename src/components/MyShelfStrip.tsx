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
  /** Если null — гость, блок не показываем. Если true — авторизован,
      но полка пустая → показываем мягкий empty-state-CTA. */
  isLoggedIn?: boolean;
}

export default function MyShelfStrip({ items, totalCount, isLoggedIn = false }: Props) {
  if (items.length === 0) {
    if (!isLoggedIn) return null;
    // Авторизованный без закладок — короткая подсказка-CTA, чтобы
    // новичок понимал, как работает полка. Вид и размер совпадают
    // с заполненным state'ом, чтобы не «прыгал» layout главной.
    return (
      <section className="container section" style={{ paddingTop: 12, paddingBottom: 12 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '14px 18px',
            background: 'var(--surface)',
            border: '1px dashed var(--border)',
            borderRadius: 'var(--radius)',
          }}
        >
          <div style={{ fontSize: 22, lineHeight: 1 }} aria-hidden="true">📚</div>
          <div style={{ flex: 1, fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--ink)' }}>Твоя полка пока пуста.</strong>{' '}
            Жми <span style={{ color: 'var(--accent)' }}>♡</span> на карточке
            любой новеллы — она будет здесь, рядом с прогрессом чтения.
          </div>
          <Link href="/catalog" className="more" style={{ whiteSpace: 'nowrap' }}>
            К каталогу →
          </Link>
        </div>
      </section>
    );
  }
 
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