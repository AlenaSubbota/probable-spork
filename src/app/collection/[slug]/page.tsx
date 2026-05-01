import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/server';
import NovelCard from '@/components/NovelCard';
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
  id: number;
  slug: string;
  title: string;
  tagline: string;
  description: string | null;
  emoji: string;
  novelIds: string[];
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

  // Ищем в БД (RLS отрежет черновики, к которым нет доступа).
  const { data: dbRow } = await supabase
    .from('collections')
    .select('id, slug, title, tagline, description, emoji, novel_ids, is_published, owner_id, updated_at')
    .eq('slug', slug)
    .maybeSingle();

  if (!dbRow) notFound();

  const c = dbRow as DbCollection;
  let ownerName: string | null = null;
  let canEdit = false;

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

  const resolved: ResolvedCollection = {
    id: c.id,
    slug: c.slug,
    title: c.title,
    tagline: c.tagline ?? '',
    description: c.description ?? null,
    emoji: c.emoji ?? '✦',
    novelIds,
    ownerId: c.owner_id,
    ownerName,
    isPublished: c.is_published,
    updatedAt: c.updated_at,
  };

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
          {resolved.ownerName ? (
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
  if (collection.novelIds.length === 0) return [];

  const { data } = await supabase
    .from('novels_view')
    .select(
      'id, firebase_id, title, author, author_en, author_original, cover_url, genres, age_rating, average_rating, rating_count, is_completed, chapter_count, description, country'
    )
    .eq('moderation_status', 'published')
    .in('firebase_id', collection.novelIds);

  const rows = (data ?? []) as NovelRow[];
  // Сохраняем порядок из novel_ids — переводчик сам выстроил.
  const order = new Map(collection.novelIds.map((id, i) => [id, i]));
  rows.sort(
    (a, b) =>
      (order.get(a.firebase_id) ?? 999) - (order.get(b.firebase_id) ?? 999)
  );
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

function stripDescription(text: string | null | undefined, max = 200): string {
  if (!text) return '';
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + '…';
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: dbRow } = await supabase
    .from('collections')
    .select('title, tagline, description, emoji, is_published')
    .eq('slug', slug)
    .maybeSingle();

  if (!dbRow) {
    return { title: 'Подборка не найдена', robots: { index: false, follow: false } };
  }

  const row = dbRow as {
    title: string;
    tagline: string | null;
    description: string | null;
    emoji: string | null;
    is_published: boolean;
  };

  const title = row.title;
  const description =
    row.tagline?.trim() ||
    stripDescription(row.description, 200) ||
    'Подборка новелл на Chaptify';

  return {
    title,
    description,
    openGraph: {
      type: 'website',
      title,
      description,
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
    robots: row.is_published ? undefined : { index: false, follow: false },
  };
}
