import Link from 'next/link';
import { getCoverUrl } from '@/lib/format';

interface NovelBrief {
  id: number;
  firebase_id: string;
  title: string;
  cover_url: string | null;
  average_rating: number | null;
  genres: string[];
}

interface Props {
  novels: NovelBrief[];
}

// Киллер-фича #3 страницы переводчика: анализ специализации.
// Показывает топ-3 жанра переводчика с долями и «три хита в главном жанре».
export default function TranslatorSpecialty({ novels }: Props) {
  if (novels.length === 0) return null;

  // Считаем жанры
  const genreMap = new Map<string, number>();
  for (const n of novels) {
    for (const g of n.genres) {
      genreMap.set(g, (genreMap.get(g) ?? 0) + 1);
    }
  }
  const sorted = Array.from(genreMap.entries()).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, c]) => s + c, 0);

  if (sorted.length === 0) return null;

  const topGenre = sorted[0][0];
  const topHits = novels
    .filter((n) => n.genres.includes(topGenre))
    .sort((a, b) => (b.average_rating ?? 0) - (a.average_rating ?? 0))
    .slice(0, 3);

  const topGenreShare = Math.round((sorted[0][1] / total) * 100);

  return (
    <section className="translator-specialty">
      <h3>Специализация</h3>
      <p className="specialty-insight">
        {topGenreShare >= 50 ? 'В основном' : 'Чаще всего —'}{' '}
        <strong>{topGenre.toLowerCase()}</strong>: {topGenreShare}% каталога ({sorted[0][1]} из {novels.length}).
      </p>

      <div className="specialty-bars">
        {sorted.slice(0, 5).map(([name, count]) => (
          <div key={name} className="book-diet-bar">
            <div className="book-diet-bar-label">
              <span>{name}</span>
              <span className="book-diet-bar-count">{count}</span>
            </div>
            <div className="book-diet-bar-track">
              <div
                className="book-diet-bar-fill"
                style={{ width: `${(count / total) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {topHits.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div className="book-diet-section-title">
            Топ-{topHits.length} в жанре «{topGenre.toLowerCase()}»
          </div>
          <div className="specialty-hits">
            {topHits.map((n, i) => {
              const cover = getCoverUrl(n.cover_url);
              return (
                <Link
                  key={n.id}
                  href={`/novel/${n.firebase_id}`}
                  className="specialty-hit"
                >
                  <div className="specialty-hit-cover">
                    {cover ? (
                      <img src={cover} alt={n.title} />
                    ) : (
                      <div className={`placeholder p${(i % 8) + 1}`} style={{ fontSize: 10 }}>
                        {n.title}
                      </div>
                    )}
                  </div>
                  <div className="specialty-hit-body">
                    <div className="specialty-hit-title">{n.title}</div>
                    {n.average_rating && (
                      <div className="specialty-hit-rating">
                        <span className="star">★</span>{' '}
                        {Number(n.average_rating).toFixed(1)}
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
