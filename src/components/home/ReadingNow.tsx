import Link from 'next/link';
import { getCoverUrl } from '@/lib/format';

export interface ReadingNowItem {
  novel_id: number;
  firebase_id: string;
  title: string;
  cover_url: string | null;
  readers_now: number;      // уникальных юзеров за последние 30 минут
  last_chapter_read: number | null;
}

interface Props {
  items: ReadingNowItem[];
  totalReadersNow: number;
}

// Hero-блок на главной: что реально читают прямо сейчас. Вместо абстрактных
// цифр «42 новеллы» — конкретные обложки, которые открыты в эту минуту.
export default function ReadingNow({ items, totalReadersNow }: Props) {
  if (items.length === 0) {
    return (
      <section className="container section reading-now">
        <div className="reading-now-empty">
          <div className="reading-now-dot" aria-hidden="true" />
          <span>В этот час все тихо. Будь первой — открой новеллу.</span>
        </div>
      </section>
    );
  }

  return (
    <section className="container section reading-now">
      <div className="section-head">
        <h2>
          <span className="reading-now-dot" aria-hidden="true" />
          Сейчас читают
          <span className="reading-now-count">
            {totalReadersNow} {pluralRu(totalReadersNow, 'читатель', 'читателя', 'читателей')}
          </span>
        </h2>
        <Link href="/catalog" className="more">Все новеллы →</Link>
      </div>

      <div className="reading-now-grid">
        {items.map((item) => {
          const cover = getCoverUrl(item.cover_url);
          const target =
            item.last_chapter_read
              ? `/novel/${item.firebase_id}/${item.last_chapter_read}`
              : `/novel/${item.firebase_id}`;
          return (
            <Link key={item.novel_id} href={target} className="reading-now-card">
              <div className="reading-now-cover">
                {cover ? (
                  <img src={cover} alt={item.title} />
                ) : (
                  <div className="placeholder p1">{item.title}</div>
                )}
                <span className="reading-now-badge">
                  <span className="reading-now-dot" aria-hidden="true" />
                  {item.readers_now}
                </span>
              </div>
              <div className="reading-now-title">{item.title}</div>
            </Link>
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
