import Link from 'next/link';
import { getCoverUrl } from '@/lib/format';

export interface CollectionPreview {
  slug: string;
  title: string;
  tagline: string;
  emoji: string;
  count: number;
  /** До 3-х превью-обложек для коллажа на карточке. */
  covers: Array<{ firebase_id: string; cover_url: string | null; title: string }>;
}

interface Props {
  items: CollectionPreview[];
}

// Редакторские подборки. Каждая карточка — название + 3 наложенные
// обложки + строчка-подзаголовок. Клик — на страницу подборки.
// Это «голос редакции» в духе Литрес/Wattpad reading lists.

export default function CollectionsStrip({ items }: Props) {
  if (items.length === 0) return null;

  return (
    <section className="container section">
      <div className="section-head">
        <h2>
          <span className="collections-mark" aria-hidden="true">✦</span>
          Подборки от редакции
        </h2>
        <span className="more" style={{ cursor: 'default' }}>
          собрано вручную
        </span>
      </div>
      <div className="collections-grid">
        {items.map((c) => (
          <Link
            key={c.slug}
            href={`/collection/${c.slug}`}
            className="collection-card"
          >
            <div className="collection-card-stack" aria-hidden="true">
              {c.covers.slice(0, 3).map((cov, i) => {
                const url = getCoverUrl(cov.cover_url);
                return (
                  <span
                    key={cov.firebase_id}
                    className={`collection-card-cover collection-card-cover-${i}`}
                  >
                    {url ? (
                      <img src={url} alt="" />
                    ) : (
                      <span className="placeholder p1">{cov.title}</span>
                    )}
                  </span>
                );
              })}
              <span className="collection-card-emoji">{c.emoji}</span>
            </div>
            <div className="collection-card-body">
              <div className="collection-card-title">{c.title}</div>
              <div className="collection-card-tagline">{c.tagline}</div>
              <div className="collection-card-count">
                {c.count} {pluralNovel(c.count)}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function pluralNovel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'новелл';
  if (mod10 === 1) return 'новелла';
  if (mod10 >= 2 && mod10 <= 4) return 'новеллы';
  return 'новелл';
}
