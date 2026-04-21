import Link from 'next/link';
import { createClient } from '@/utils/supabase/server';
import NovelCard from '@/components/NovelCard';
import CatalogFilters from '@/components/CatalogFilters';
import MoodPicker from '@/components/MoodPicker';
import { getCoverUrl } from '@/lib/format';
import {
  getMood,
  getReadingBucket,
  sortColumn,
  READING_BUCKETS,
  type SortKey,
  type MoodKey,
} from '@/lib/catalog';

const PAGE_SIZE = 24;

interface CatalogParams {
  mood?: string;
  genre?: string;
  status?: string;
  time?: string;
  sort?: string;
  age?: string;
  page?: string;
}

const AGE_RE = /^\d{1,2}\+$/;

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<CatalogParams>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const mood = getMood(params.mood);
  const bucket = getReadingBucket(params.time);
  const sortKey: SortKey =
    (params.sort as SortKey) && ['rating', 'new', 'views', 'alpha', 'chapters'].includes(params.sort!)
      ? (params.sort as SortKey)
      : 'rating';
  const sort = sortColumn(sortKey);

  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // ---- Запрос каталога ----
  let query = supabase
    .from('novels_view')
    .select(
      'id, firebase_id, title, author, cover_url, genres, age_rating, average_rating, rating_count, views, is_completed, chapter_count, latest_chapter_published_at, description',
      { count: 'exact' }
    );

  if (params.status === 'completed') query = query.eq('is_completed', true);
  if (params.status === 'ongoing')   query = query.eq('is_completed', false);

  // Возрастное ограничение: теперь в отдельной колонке, не в жанрах
  if (params.age && ['6+', '12+', '16+', '18+'].includes(params.age)) {
    query = query.eq('age_rating', params.age);
  }

  // Фильтр по жанру (jsonb contains)
  if (params.genre) {
    query = query.contains('genres', [params.genre]);
  }

  // Настроение: OR по набору жанров + минимальный рейтинг
  if (mood) {
    const genreOrs = mood.genres.map((g) => `genres.cs.["${g}"]`).join(',');
    if (genreOrs) query = query.or(genreOrs);
    query = query.gte('average_rating', mood.minRating);
  }

  // Время чтения (bucket по chapter_count)
  if (bucket) {
    query = query.gte('chapter_count', bucket.min).lte('chapter_count', bucket.max);
  }

  query = query.order(sort.column, { ascending: sort.ascending, nullsFirst: false });
  query = query.range(from, to);

  const { data: novels, count } = await query;

  // ---- Список жанров для сайдбара (считаем по всему каталогу, без фильтров) ----
  const { data: allForGenres } = await supabase
    .from('novels_view')
    .select('genres');

  const genreMap: Record<string, number> = {};
  (allForGenres ?? []).forEach((n) => {
    const gs = n.genres;
    if (Array.isArray(gs)) {
      for (const g of gs) {
        // Убираем возрастные токены из жанров (они теперь в age_rating)
        if (typeof g === 'string' && AGE_RE.test(g.trim())) continue;
        genreMap[g] = (genreMap[g] ?? 0) + 1;
      }
    }
  });
  const genres = Object.entries(genreMap)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // ---- Строим query-string для пагинации ----
  const pageUrl = (n: number) => {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (k === 'page') continue;
      if (v) usp.set(k, v as string);
    }
    if (n > 1) usp.set('page', String(n));
    const qs = usp.toString();
    return qs ? `/catalog?${qs}` : '/catalog';
  };

  return (
    <main className="container">
      {/* Заголовок + описание активного mood */}
      <div className="catalog-header">
        <h1>{mood ? mood.label : 'Каталог новелл'}</h1>
        <p style={{ color: 'var(--ink-mute)', margin: '6px 0 0' }}>
          {mood
            ? mood.tagline
            : 'Найди следующую любимую историю — по жанру, настроению или времени чтения.'}
        </p>
      </div>

      {/* Быстрый mood picker над сеткой (компактный) */}
      <MoodPicker activeMood={mood?.key as MoodKey | undefined} variant="compact" />

      <div className="catalog-layout">
        <CatalogFilters
          current={params}
          genres={genres.slice(0, 30)}
          totalCount={allForGenres?.length ?? 0}
        />

        <div className="catalog-main">
          <div className="catalog-toolbar">
            <div className="catalog-count">
              Найдено <strong>{totalCount}</strong>{' '}
              {pluralNovels(totalCount)}
              {(params.genre || params.time || params.mood || params.status) && (
                <Link href="/catalog" className="more" style={{ marginLeft: 14 }}>
                  Сбросить фильтры
                </Link>
              )}
            </div>
          </div>

          {novels && novels.length > 0 ? (
            <div className="novel-grid">
              {novels.map((novel, index) => (
                <NovelCard
                  key={novel.id}
                  id={novel.firebase_id}
                  title={novel.title}
                  translator={novel.author || 'Алёна'}
                  metaInfo={`${novel.chapter_count ?? 0} гл.`}
                  rating={
                    novel.average_rating
                      ? Number(novel.average_rating).toFixed(1)
                      : '—'
                  }
                  coverUrl={getCoverUrl(novel.cover_url)}
                  placeholderClass={`p${(index % 8) + 1}`}
                  placeholderText={novel.title.substring(0, 10) + '...'}
                  chapterCount={novel.chapter_count}
                  flagText={novel.is_completed ? 'FIN' : undefined}
                  flagClass={novel.is_completed ? 'done' : undefined}
                  description={(novel as { description?: string | null }).description ?? null}
                  genres={
                    Array.isArray(novel.genres)
                      ? (novel.genres as string[]).filter(
                          (g) => typeof g === 'string' && !AGE_RE.test(g.trim())
                        )
                      : null
                  }
                  ageRating={(novel as { age_rating?: string | null }).age_rating ?? null}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <p>Под эти фильтры ничего не подошло.</p>
              <Link href="/catalog" className="btn btn-ghost">
                Сбросить и показать всё
              </Link>
            </div>
          )}

          {/* Пагинация */}
          {totalPages > 1 && (
            <nav className="pagination" aria-label="Пагинация">
              {page > 1 && (
                <Link href={pageUrl(page - 1)} className="page-link">
                  ← Назад
                </Link>
              )}
              {renderPages(page, totalPages).map((p, i) =>
                p === '…' ? (
                  <span key={`e${i}`} className="page-ellipsis">…</span>
                ) : (
                  <Link
                    key={p}
                    href={pageUrl(p as number)}
                    className={`page-link${p === page ? ' active' : ''}`}
                  >
                    {p}
                  </Link>
                )
              )}
              {page < totalPages && (
                <Link href={pageUrl(page + 1)} className="page-link">
                  Вперёд →
                </Link>
              )}
            </nav>
          )}
        </div>
      </div>
    </main>
  );
}

function pluralNovels(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return 'новелл';
  if (mod10 === 1) return 'новелла';
  if (mod10 >= 2 && mod10 <= 4) return 'новеллы';
  return 'новелл';
}

function renderPages(page: number, total: number): (number | '…')[] {
  const out: (number | '…')[] = [];
  const add = (v: number | '…') => out.push(v);

  if (total <= 7) {
    for (let i = 1; i <= total; i++) add(i);
    return out;
  }
  add(1);
  if (page > 3) add('…');
  for (let i = Math.max(2, page - 1); i <= Math.min(total - 1, page + 1); i++) add(i);
  if (page < total - 2) add('…');
  add(total);
  return out;
}
