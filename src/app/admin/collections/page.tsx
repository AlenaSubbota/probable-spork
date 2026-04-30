import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { timeAgo } from '@/lib/format';
import FeatureToggle from '@/components/admin/CollectionFeatureToggle';

export const metadata = { title: 'Подборки · Админка — Chaptify' };

interface Filters {
  scope?: string; // all | published | drafts | featured
}

type Row = {
  id: number;
  slug: string;
  title: string;
  emoji: string | null;
  novel_ids: unknown;
  is_published: boolean;
  is_featured: boolean;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  owner?: {
    user_name: string | null;
    translator_display_name: string | null;
  } | null;
};

export default async function AdminCollectionsPage({
  searchParams,
}: {
  searchParams: Promise<Filters>;
}) {
  const params = await searchParams;
  const scope = params.scope ?? 'all';

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_admin')
    .eq('id', user.id)
    .maybeSingle();
  const p = profile as { role?: string; is_admin?: boolean } | null;
  const isAdmin = p?.is_admin === true || p?.role === 'admin';
  if (!isAdmin) redirect('/admin');

  // Берём все подборки. Админская SELECT-политика разрешит читать всё,
  // включая черновики любых авторов.
  let query = supabase
    .from('collections')
    .select(
      'id, slug, title, emoji, novel_ids, is_published, is_featured, owner_id, created_at, updated_at'
    )
    .order('is_featured', { ascending: false })
    .order('updated_at', { ascending: false });

  if (scope === 'published') query = query.eq('is_published', true);
  else if (scope === 'drafts') query = query.eq('is_published', false);
  else if (scope === 'featured') query = query.eq('is_featured', true);

  const { data: rows } = await query;
  const collections = (rows ?? []) as Row[];

  // Подгружаем имена авторов одним запросом.
  const ownerIds = Array.from(
    new Set(
      collections
        .map((c) => c.owner_id)
        .filter((x): x is string => typeof x === 'string')
    )
  );
  let ownerMap = new Map<string, { user_name: string | null; translator_display_name: string | null }>();
  if (ownerIds.length > 0) {
    const { data: owners } = await supabase
      .from('profiles')
      .select('id, user_name, translator_display_name')
      .in('id', ownerIds);
    ownerMap = new Map(
      (owners ?? []).map((o) => [
        o.id as string,
        {
          user_name: (o.user_name ?? null) as string | null,
          translator_display_name:
            (o.translator_display_name ?? null) as string | null,
        },
      ])
    );
  }

  const SCOPES: Array<{ key: string; label: string }> = [
    { key: 'all', label: 'Все' },
    { key: 'published', label: 'Опубликованные' },
    { key: 'drafts', label: 'Черновики' },
    { key: 'featured', label: 'На главной' },
  ];

  return (
    <main className="container admin-page">
      <div className="admin-breadcrumbs">
        <Link href="/admin">Админка</Link>
        <span>/</span>
        <span>Подборки</span>
      </div>

      <header className="admin-head">
        <div>
          <h1>Подборки</h1>
          <p className="admin-head-sub">
            Все курируемые наборы новелл — переводчиков и редакторские.
            Закрепи нужные на главной звёздочкой.
          </p>
        </div>
        <Link href="/collections/new" className="btn btn-primary">
          + Подборка
        </Link>
      </header>

      <nav className="admin-collections-scope">
        {SCOPES.map((s) => (
          <Link
            key={s.key}
            href={s.key === 'all' ? '/admin/collections' : `/admin/collections?scope=${s.key}`}
            className={`admin-collections-scope-tab${scope === s.key ? ' is-active' : ''}`}
          >
            {s.label}
          </Link>
        ))}
      </nav>

      {collections.length === 0 ? (
        <div className="empty-state">
          <p>В этой выборке подборок нет.</p>
          {scope !== 'all' && (
            <Link href="/admin/collections" className="btn btn-ghost">
              Показать все
            </Link>
          )}
        </div>
      ) : (
        <div className="admin-collections-list">
          {collections.map((c) => {
            const novelCount = Array.isArray(c.novel_ids)
              ? c.novel_ids.length
              : 0;
            const owner = c.owner_id ? ownerMap.get(c.owner_id) : null;
            const ownerName = owner
              ? owner.translator_display_name || owner.user_name || 'без имени'
              : 'удалённый автор';
            return (
              <div key={c.id} className="admin-collections-row">
                <div className="admin-collections-row-emoji">
                  {c.emoji ?? '✦'}
                </div>
                <div className="admin-collections-row-body">
                  <Link
                    href={`/collection/${c.slug}`}
                    className="admin-collections-row-title"
                  >
                    {c.title}
                  </Link>
                  <div className="admin-collections-row-meta">
                    {c.is_published ? (
                      <span className="admin-collections-row-badge admin-collections-row-badge-pub">
                        опубликована
                      </span>
                    ) : (
                      <span className="admin-collections-row-badge admin-collections-row-badge-draft">
                        черновик
                      </span>
                    )}
                    <span className="admin-collections-row-sep">·</span>
                    <span>
                      {novelCount} {pluralRu(novelCount, 'новелла', 'новеллы', 'новелл')}
                    </span>
                    <span className="admin-collections-row-sep">·</span>
                    <span>{ownerName}</span>
                    <span className="admin-collections-row-sep">·</span>
                    <span title={new Date(c.updated_at).toLocaleString('ru-RU')}>
                      обновлена {timeAgo(c.updated_at)}
                    </span>
                  </div>
                </div>
                <div className="admin-collections-row-actions">
                  <FeatureToggle
                    collectionId={c.id}
                    initialFeatured={c.is_featured}
                    isPublished={c.is_published}
                  />
                  <Link
                    href={`/collections/${c.slug}/edit`}
                    className="btn btn-ghost"
                    style={{ height: 34 }}
                  >
                    Редактировать
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
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
