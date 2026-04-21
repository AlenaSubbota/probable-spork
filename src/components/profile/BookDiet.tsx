import Link from 'next/link';
import { COUNTRY_LABELS, type Country } from '@/lib/admin';

interface ReadNovel {
  id: number;
  title: string;
  genres: string[];
  country: string | null;
}

interface Props {
  readNovels: ReadNovel[];
  suggestions: Array<{
    firebase_id: string;
    title: string;
    average_rating: number | null;
    genres: string[];
    reason: string;
  }>;
}

// Киллер-фича #3 профиля: «Книжная диета».
// Анализирует жанры и страны прочитанных новелл, показывает
// разбивку и подсказывает «попробуй ещё X» из непокрытых жанров.
export default function BookDiet({ readNovels, suggestions }: Props) {
  if (readNovels.length === 0) {
    return (
      <div className="book-diet">
        <div className="book-diet-head">
          <h3>Книжная диета</h3>
          <p className="streak-sub">
            Разбивка твоих вкусов появится, когда ты начнёшь читать.
          </p>
        </div>
      </div>
    );
  }

  // Считаем жанры
  const genreMap = new Map<string, number>();
  for (const n of readNovels) {
    for (const g of n.genres) {
      genreMap.set(g, (genreMap.get(g) ?? 0) + 1);
    }
  }
  const genreList = Array.from(genreMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const totalGenreHits = genreList.reduce((s, [, n]) => s + n, 0);

  // Считаем страны
  const countryMap = new Map<string, number>();
  for (const n of readNovels) {
    const k = n.country ?? 'unknown';
    countryMap.set(k, (countryMap.get(k) ?? 0) + 1);
  }
  const countryList = Array.from(countryMap.entries())
    .sort((a, b) => b[1] - a[1]);

  const topGenre = genreList[0]?.[0];

  // Доля топ-жанра
  const topGenreShare =
    topGenre && totalGenreHits > 0
      ? Math.round((genreList[0][1] / totalGenreHits) * 100)
      : 0;

  return (
    <div className="book-diet">
      <div className="book-diet-head">
        <h3>Книжная диета</h3>
        <p className="streak-sub">
          Из {readNovels.length}{' '}
          {pluralRu(readNovels.length, 'открытой новеллы', 'открытых новелл', 'открытых новелл')}
        </p>
      </div>

      {topGenre && (
        <p className="book-diet-insight">
          Ты любишь <strong>{topGenre}</strong> — {topGenreShare}% твоих новелл.
        </p>
      )}

      <div className="book-diet-section">
        <div className="book-diet-section-title">Жанры</div>
        <div className="book-diet-bars">
          {genreList.map(([name, count]) => {
            const pct = totalGenreHits > 0 ? (count / totalGenreHits) * 100 : 0;
            return (
              <div key={name} className="book-diet-bar">
                <div className="book-diet-bar-label">
                  <span>{name}</span>
                  <span className="book-diet-bar-count">{count}</span>
                </div>
                <div className="book-diet-bar-track">
                  <div
                    className="book-diet-bar-fill"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="book-diet-section">
        <div className="book-diet-section-title">Страны</div>
        <div className="book-diet-countries">
          {countryList.map(([k, count]) => {
            const label =
              k === 'unknown'
                ? 'Не указана'
                : COUNTRY_LABELS[k as Country] ?? k;
            return (
              <div key={k} className="book-diet-country">
                <span className="book-diet-country-count">{count}</span>
                <span className="book-diet-country-label">{label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {suggestions.length > 0 && (
        <div className="book-diet-section">
          <div className="book-diet-section-title">Попробуй ещё</div>
          <div className="book-diet-suggest">
            {suggestions.map((s) => (
              <Link
                key={s.firebase_id}
                href={`/novel/${s.firebase_id}`}
                className="book-diet-suggest-card"
              >
                <div className="book-diet-suggest-title">{s.title}</div>
                <div className="book-diet-suggest-reason">
                  {s.reason}
                  {s.average_rating && (
                    <> · ★ {Number(s.average_rating).toFixed(1)}</>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
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
