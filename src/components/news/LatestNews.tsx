import Link from 'next/link';
import NewsCard, { type NewsItem } from './NewsCard';

interface Props {
  items: NewsItem[];
  unreadCount: number;
}

// Блок новостей на главной — показывает до 3-х свежих / закреплённых.
// Пустой блок (когда новостей нет) — скрывается.
export default function LatestNews({ items, unreadCount }: Props) {
  if (!items || items.length === 0) return null;

  return (
    <section className="container section">
      <div className="section-head">
        <h2>
          Новости
          {unreadCount > 0 && (
            <span className="latest-news-badge">
              {unreadCount} {pluralRu(unreadCount, 'новая', 'новых', 'новых')}
            </span>
          )}
        </h2>
        <Link href="/news" className="more">Все новости →</Link>
      </div>

      <div className="latest-news-grid">
        {items.slice(0, 3).map((n) => (
          <NewsCard key={n.id} news={n} compact />
        ))}
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
