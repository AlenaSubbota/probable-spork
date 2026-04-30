import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/server';
import NovelCard from '@/components/NovelCard';
import { getCollection, type Collection } from '@/lib/collections';
import { getCoverUrl, formatAuthorPrimary, cleanGenres } from '@/lib/format';

const COLLECTION_LIMIT = 24;

type NovelRow = {
  id: number;
  firebase_id: string;
  title: string;
  author: string | null;
  author_en: string | null;
  author_original: string | null;
  cover_url: string | null;
  genres: unknown;
  age_rating: string | null;
  average_rating: number | null;
  rating_count: number | null;
  is_completed: boolean | null;
  chapter_count: number | null;
  description: string | null;
  country: string | null;
};

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const collection = getCollection(slug);
  if (!collection) notFound();

  const supabase = await createClient();
  const novels = await fetchCollectionNovels(supabase, collection);

  return (
    <main className="container">
      <div className="collection-page-header">
        <span className="collection-page-emoji" aria-hidden="true">
          {collection.emoji}
        </span>
        <h1>{collection.title}</h1>
        <p className="collection-page-tagline">{collection.tagline}</p>
        <div className="collection-page-meta">
          {novels.length} {pluralNovels(novels.length)} · собрано вручную редакцией
          <span className="collection-page-sep">·</span>
          <Link href="/" className="more">
            ← На главную
          </Link>
        </div>
      </div>

      {novels.length > 0 ? (
        <div className="novel-grid">
          {novels.map((novel, index) => {
            const authorLabel =
              formatAuthorPrimary(
                novel.author,
                novel.author_en,
                novel.author_original
              ) || 'Автор не указан';
            return (
              <NovelCard
                key={novel.id}
                id={novel.firebase_id}
                title={novel.title}
                translator={authorLabel}
                byHref={
                  novel.author
                    ? `/search?q=${encodeURIComponent(novel.author)}`
                    : null
                }
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
                description={novel.description ?? null}
                genres={cleanGenres(novel.genres)}
                ageRating={novel.age_rating ?? null}
              />
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <p>Подборка пока пустует. Возвращайся позже — редакция добирает.</p>
          <Link href="/catalog" className="btn btn-ghost">
            В общий каталог
          </Link>
        </div>
      )}
    </main>
  );
}

// Загружает новеллы для подборки. Если задан явный список firebase_id —
// фильтр по нему; иначе — выборка по smartFilter (страна / жанры /
// минимальный рейтинг). Жанры фильтруем в JS, потому что jsonb-overlap
// в нашей версии PostgREST капризничает на кириллице.
async function fetchCollectionNovels(
  supabase: Awaited<ReturnType<typeof createClient>>,
  collection: Collection
): Promise<NovelRow[]> {
  let query = supabase
    .from('novels_view')
    .select(
      'id, firebase_id, title, author, author_en, author_original, cover_url, genres, age_rating, average_rating, rating_count, is_completed, chapter_count, description, country'
    )
    .eq('moderation_status', 'published');

  if (collection.novelIds && collection.novelIds.length > 0) {
    query = query.in('firebase_id', collection.novelIds);
  } else if (collection.smartFilter) {
    const f = collection.smartFilter;
    if (f.country) query = query.eq('country', f.country);
    if (f.minRating !== undefined) {
      query = query.or(
        `average_rating.eq.0,average_rating.gte.${f.minRating}`
      );
    }
    query = query
      .order('average_rating', { ascending: false, nullsFirst: false })
      .limit(80);
  }

  const { data } = await query;
  let rows = (data ?? []) as NovelRow[];

  // Фильтр по жанрам — в JS (см. комментарий выше).
  if (collection.smartFilter?.genres && collection.smartFilter.genres.length > 0) {
    const targets = new Set(collection.smartFilter.genres);
    rows = rows.filter((n) => {
      if (!Array.isArray(n.genres)) return false;
      for (const g of n.genres) {
        if (typeof g === 'string' && targets.has(g)) return true;
      }
      return false;
    });
  }

  // Если был использован явный список — сортируем по порядку списка.
  if (collection.novelIds && collection.novelIds.length > 0) {
    const order = new Map(collection.novelIds.map((id, i) => [id, i]));
    rows.sort((a, b) => (order.get(a.firebase_id) ?? 999) - (order.get(b.firebase_id) ?? 999));
  }

  return rows.slice(0, COLLECTION_LIMIT);
}

function pluralNovels(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'новелл';
  if (mod10 === 1) return 'новелла';
  if (mod10 >= 2 && mod10 <= 4) return 'новеллы';
  return 'новелл';
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const c = getCollection(slug);
  if (!c) return { title: 'Подборка не найдена' };
  return {
    title: `${c.title} — Chaptify`,
    description: c.tagline,
  };
}
