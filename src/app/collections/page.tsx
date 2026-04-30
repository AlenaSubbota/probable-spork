import Link from 'next/link';
import { createClient } from '@/utils/supabase/server';
import { COLLECTIONS as STATIC_COLLECTIONS } from '@/lib/collections';

export const metadata = { title: 'Подборки — Chaptify' };

type DbCollection = {
  id: number;
  slug: string;
  title: string;
  tagline: string | null;
  emoji: string | null;
  novel_ids: unknown;
  is_published: boolean;
  is_featured: boolean;
  owner_id: string | null;
  updated_at: string;
};

export default async function CollectionsIndexPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Берём опубликованные подборки + свои черновики (если автор) +
  // всё (если админ). Реализуем тремя запросами для чистоты RLS.
  const promises: Array<Promise<{ data: DbCollection[] | null }>> = [
    supabase
      .from('collections')
      .select('id, slug, title, tagline, emoji, novel_ids, is_published, is_featured, owner_id, updated_at')
      .eq('is_published', true)
      .order('is_featured', { ascending: false })
      .order('updated_at', { ascending: false }) as unknown as Promise<{ data: DbCollection[] | null }>,
  ];

  let myDrafts: DbCollection[] = [];
  let isAdmin = false;
  let canCreate = false;

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, is_admin')
      .eq('id', user.id)
      .maybeSingle();
    const p = profile as { role?: string; is_admin?: boolean } | null;
    isAdmin = p?.is_admin === true || p?.role === 'admin';
    canCreate = isAdmin || p?.role === 'translator';

    const { data: drafts } = await supabase
      .from('collections')
      .select('id, slug, title, tagline, emoji, novel_ids, is_published, is_featured, owner_id, updated_at')
      .eq('owner_id', user.id)
      .eq('is_published', false)
      .order('updated_at', { ascending: false });
    myDrafts = (drafts ?? []) as DbCollection[];
  }

  const [{ data: published }] = await Promise.all(promises);
  const dbPublished = (published ?? []) as DbCollection[];

  const dbSlugSet = new Set(dbPublished.map((c) => c.slug));
  // Статические подборки показываем как «системные» — они не в БД,
  // но фигурируют на сайте как редакторские, заданные кодом.
  const systemList = STATIC_COLLECTIONS.filter((s) => !dbSlugSet.has(s.slug));

  return (
    <main className="container collections-index">
      <header className="collections-index-header">
        <h1>Подборки</h1>
        <p className="collections-index-lead">
          Кураторские наборы новелл от редакции и переводчиков. Собирай свою —
          и делись с читателями.
        </p>
        {canCreate && (
          <Link href="/collections/new" className="btn btn-primary">
            + Создать подборку
          </Link>
        )}
        {!user && (
          <p className="collections-index-hint">
            Чтобы создавать собственные подборки, нужно войти переводчиком.
          </p>
        )}
      </header>

      {myDrafts.length > 0 && (
        <section className="collections-index-section">
          <h2>Мои черновики</h2>
          <ul className="collections-index-grid">
            {myDrafts.map((c) => renderCard(c, true, true))}
          </ul>
        </section>
      )}

      {dbPublished.length > 0 && (
        <section className="collections-index-section">
          <h2>Опубликованные</h2>
          <ul className="collections-index-grid">
            {dbPublished.map((c) =>
              renderCard(c, isAdmin || c.owner_id === user?.id, false)
            )}
          </ul>
        </section>
      )}

      {systemList.length > 0 && (
        <section className="collections-index-section">
          <h2>Системные</h2>
          <p className="collections-index-sub">
            Заданы редакцией в коде сайта.
          </p>
          <ul className="collections-index-grid">
            {systemList.map((s) => (
              <li key={s.slug} className="collections-index-card">
                <Link href={`/collection/${s.slug}`} className="collections-index-card-link">
                  <span className="collections-index-card-emoji">{s.emoji}</span>
                  <span className="collections-index-card-body">
                    <span className="collections-index-card-title">{s.title}</span>
                    <span className="collections-index-card-tagline">{s.tagline}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dbPublished.length === 0 && myDrafts.length === 0 && systemList.length === 0 && (
        <div className="empty-state">
          <p>Подборок пока нет.</p>
          {canCreate && (
            <Link href="/collections/new" className="btn btn-primary">
              Создать первую
            </Link>
          )}
        </div>
      )}
    </main>
  );
}

function renderCard(c: DbCollection, canEdit: boolean, isDraft: boolean) {
  const novelCount = Array.isArray(c.novel_ids) ? c.novel_ids.length : 0;
  return (
    <li key={c.id} className="collections-index-card">
      <Link href={`/collection/${c.slug}`} className="collections-index-card-link">
        <span className="collections-index-card-emoji">{c.emoji ?? '✦'}</span>
        <span className="collections-index-card-body">
          <span className="collections-index-card-title">
            {c.title}
            {c.is_featured && (
              <span className="collections-index-card-pin" title="Закреплено на главной">
                ★
              </span>
            )}
          </span>
          {c.tagline && (
            <span className="collections-index-card-tagline">{c.tagline}</span>
          )}
          <span className="collections-index-card-meta">
            {novelCount} {pluralNovels(novelCount)}
            {isDraft && (
              <>
                <span className="collections-index-card-sep">·</span>
                <span className="collections-index-card-draft">черновик</span>
              </>
            )}
          </span>
        </span>
      </Link>
      {canEdit && (
        <Link
          href={`/collections/${c.slug}/edit`}
          className="collections-index-card-edit"
          title="Редактировать"
        >
          ✎
        </Link>
      )}
    </li>
  );
}

function pluralNovels(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'новелл';
  if (mod10 === 1) return 'новелла';
  if (mod10 >= 2 && mod10 <= 4) return 'новеллы';
  return 'новелл';
}

