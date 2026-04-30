import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/server';
import NovelCard from '@/components/NovelCard';
import { getCollection as getStaticCollection, type Collection } from '@/lib/collections';
import { getCoverUrl, formatAuthorPrimary, cleanGenres } from '@/lib/format';

const COLLECTION_LIMIT = 50;

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

type DbCollection = {
  id: number;
  slug: string;
  title: string;
  tagline: string | null;
  description: string | null;
  emoji: string | null;
  novel_ids: unknown;
  is_published: boolean;
  owner_id: string | null;
  updated_at: string;
};

interface ResolvedCollection {
  source: 'db' | 'static';
  id?: number;
  slug: string;
  title: string;
  tagline: string;
  description: string | null;
  emoji: string;
  novelIds: string[] | null;
  smartFilter: Collection['smartFilter'] | null;
  ownerId: string | null;
  ownerName?: string | null;
  isPublished: boolean;
  updatedAt: string | null;
}

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // 1. Сначала ищем в БД (RLS отрежет черновики, к которым нет доступа).
  const { data: dbRow } = await supabase
    .from('collections')
    .select('id, slug, title, tagline, description, emoji, novel_ids, is_published, owner_id, updated_at')
    .eq('slug', slug)
    .maybeSingle();

  let resolved: ResolvedCollection | null = null;
  let ownerName: string | null = null;
  let canEdit = false;

  if (dbRow) {
    const c = dbRow as DbCollection;
    if (c.owner_id) {
      const { data: ownerProfile } = await supabase
        .from('profiles')
        .select('user_name, translator_display_name')
        .eq('id', c.owner_id)
        .maybeSingle();
      const op = ownerProfile as
        | { user_name?: string | null; translator_display_name?: string | null }
        | null;
      ownerName =
        op?.translator_display_name || op?.user_name || null;
    }

    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, is_admin')
        .eq('id', user.id)
        .maybeSingle();
      const p = profile as { role?: string; is_admin?: boolean } | null;
      canEdit =
        p?.is_admin === true ||
        p?.role === 'admin' ||
        c.owner_id === user.id;
    }

    const novelIds = Array.isArray(c.novel_ids)
      ? (c.novel_ids as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];

    resolved = {
      source: 'db',
      id: c.id,
      slug: c.slug,
      title: c.title,
      tagline: c.tagline ?? '',
      description: c.description ?? null,
      emoji: c.emoji ?? '✦',
      novelIds,
      smartFilter: null,
      ownerId: c.owner_id,
      ownerName,
      isPublished: c.is_published,
      updatedAt: c.updated_at,
    };
  } else {
    // 2. Fallback — статический набор из lib/collections.ts.
    const sc = getStaticCollection(slug);
    if (!sc) notFound();
    resolved = {
      source: 'static',
      slug: sc.slug,
      title: sc.title,
      tagline: sc.tagline,
      description: null,
      emoji: sc.emoji,
      novelIds: sc.novelIds ?? null,
      smartFilter: sc.smartFilter ?? null,
      ownerId: null,
      isPublished: true,
      updatedAt: null,
    };
  }

  const novels = await fetchCollectionNovels(supabase, resolved);

  return (
    <main className="container">
      <div className="collection-page-header">
        <span className="collection-page-emoji" aria-hidden="true">
          {resolved.emoji}
        </span>
        <h1>{resolved.title}</h1>
        {resolved.tagline && (
          <p className="collection-page-tagline">{resolved.tagline}</p>
        )}
        {resolved.description && (
          <div className="collection-page-description">
            {resolved.description.split(/\n{2,}/).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        )}
        <div className="collection-page-meta">
          {novels.length} {pluralNovels(novels.length)}
          <span className="collection-page-sep">·</span>
          {resolved.source === 'db' && resolved.ownerName ? (
            <span>собрал(а) {resolved.ownerName}</span>
          ) : (
            <span>собрано редакцией</span>
          )}
          {!resolved.isPublished && (
            <>
              <span className="collection-page-sep">·</span>
              <span className="collection-page-draft">черновик</span>
            </>
          )}
          <span className="collection-page-sep">·</span>
          <Link href="/collections" className="more">
            Все подборки →
          </Link>
          {canEdit && (
            <>
              <span className="collection-page-sep">·</span>
              <Link
                href={`/collections/${resolved.slug}/edit`}
                className="more"
              >
                ✎ Редактировать
              </Link>
            </>
          )}
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
          <p>Подборка пока пустует.</p>
          <Link href="/catalog" className="btn btn-ghost">
            В общий каталог
          </Link>
        </div>
      )}
    </main>
  );
}

async function fetchCollectionNovels(
  supabase: Awaited<ReturnType<typeof createClient>>,
  collection: ResolvedCollection
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
  } else {
    return [];
  }

  const { data } = await query;
  let rows = (data ?? []) as NovelRow[];

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
  const supabase = await createClient();
  const { data: dbRow } = await supabase
    .from('collections')
    .select('title, tagline')
    .eq('slug', slug)
    .maybeSingle();
  if (dbRow) {
    return {
      title: `${(dbRow as { title: string }).title} — Chaptify`,
      description: (dbRow as { tagline: string | null }).tagline ?? undefined,
    };
  }
  const sc = getStaticCollection(slug);
  if (!sc) return { title: 'Подборка не найдена' };
  return {
    title: `${sc.title} — Chaptify`,
    description: sc.tagline,
  };
}
