import Link from 'next/link';
import {
  MOODS,
  READING_BUCKETS,
  SORT_LABELS,
  buildCatalogUrl,
  type SortKey,
  type MoodKey,
  type ReadingBucket,
} from '@/lib/catalog';

interface Props {
  current: {
    mood?: string;
    genre?: string;
    status?: string;
    time?: string;
    sort?: string;
  };
  genres: { name: string; count: number }[];
  totalCount: number;
}

export default function CatalogFilters({ current, genres, totalCount }: Props) {
  const allSorts = Object.entries(SORT_LABELS) as [SortKey, string][];

  return (
    <aside className="catalog-sidebar">
      {/* Настроение */}
      <div className="filter-group">
        <h4>Настроение</h4>
        <div className="filter-pills">
          <Link
            href={buildCatalogUrl(current, { mood: undefined })}
            className={`filter-pill${!current.mood ? ' active' : ''}`}
          >
            Любое
          </Link>
          {MOODS.map((m) => (
            <Link
              key={m.key}
              href={buildCatalogUrl(current, { mood: m.key })}
              className={`filter-pill${current.mood === m.key ? ' active' : ''}`}
            >
              <span aria-hidden="true">{m.emoji}</span> {m.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Время чтения */}
      <div className="filter-group">
        <h4>Время чтения</h4>
        <div className="filter-pills">
          <Link
            href={buildCatalogUrl(current, { time: undefined })}
            className={`filter-pill${!current.time ? ' active' : ''}`}
          >
            Любое
          </Link>
          {READING_BUCKETS.map((b) => (
            <Link
              key={b.key}
              href={buildCatalogUrl(current, { time: b.key })}
              className={`filter-pill${current.time === b.key ? ' active' : ''}`}
              title={b.description}
            >
              {b.label}
              <span className="pill-sub">{b.description}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Статус */}
      <div className="filter-group">
        <h4>Статус</h4>
        <div className="filter-pills">
          <Link
            href={buildCatalogUrl(current, { status: undefined })}
            className={`filter-pill${!current.status ? ' active' : ''}`}
          >
            Все
          </Link>
          <Link
            href={buildCatalogUrl(current, { status: 'ongoing' })}
            className={`filter-pill${current.status === 'ongoing' ? ' active' : ''}`}
          >
            Продолжается
          </Link>
          <Link
            href={buildCatalogUrl(current, { status: 'completed' })}
            className={`filter-pill${current.status === 'completed' ? ' active' : ''}`}
          >
            Завершено
          </Link>
        </div>
      </div>

      {/* Жанры */}
      {genres.length > 0 && (
        <div className="filter-group">
          <h4>Жанр</h4>
          <div className="filter-pills">
            <Link
              href={buildCatalogUrl(current, { genre: undefined })}
              className={`filter-pill${!current.genre ? ' active' : ''}`}
            >
              Все <span className="pill-count">{totalCount}</span>
            </Link>
            {genres.map((g) => (
              <Link
                key={g.name}
                href={buildCatalogUrl(current, { genre: g.name })}
                className={`filter-pill${current.genre === g.name ? ' active' : ''}`}
              >
                {g.name} <span className="pill-count">{g.count}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Сортировка */}
      <div className="filter-group">
        <h4>Сортировка</h4>
        <div className="filter-pills">
          {allSorts.map(([key, label]) => (
            <Link
              key={key}
              href={buildCatalogUrl(current, { sort: key })}
              className={`filter-pill${(current.sort ?? 'rating') === key ? ' active' : ''}`}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
    </aside>
  );
}
