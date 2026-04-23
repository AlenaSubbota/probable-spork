import Link from 'next/link';
import { createClient } from '@/utils/supabase/server';
import { getCoverUrl, timeAgo } from '@/lib/format';
import FeedFilter from '@/components/feed/FeedFilter';

const PAGE_SIZE = 80; // увеличили: после батчинга глав в строки уходит ~3-5
const HOT_WINDOW_DAYS = 3;
const HOT_MIN_CHAPTERS = 3;

interface ChapterFeedRow {
  id: number;
  chapter_number: number;
  is_paid: boolean;
  published_at: string;
  novel_id: number;
}

// Сгруппированный батч одной новеллы: подряд идущие главы из одной новеллы
// схлопываются в одну строку «Глава N + ещё M». Самая ранняя глава в батче —
// та, на которую кликаем (читать сначала).
interface FeedBatch {
  novelId: number;
  latestChapter: number;
  oldestChapter: number;
  count: number;
  latestAt: string;
  hasPaid: boolean;
  ids: number[];
}

function groupConsecutive(chapters: ChapterFeedRow[]): FeedBatch[] {
  const out: FeedBatch[] = [];
  for (const c of chapters) {
    const last = out[out.length - 1];
    if (last && last.novelId === c.novel_id) {
      last.count += 1;
      last.oldestChapter = Math.min(last.oldestChapter, c.chapter_number);
      last.latestChapter = Math.max(last.latestChapter, c.chapter_number);
      last.hasPaid = last.hasPaid || c.is_paid;
      last.ids.push(c.id);
    } else {
      out.push({
        novelId: c.novel_id,
        latestChapter: c.chapter_number,
        oldestChapter: c.chapter_number,
        count: 1,
        latestAt: c.published_at,
        hasPaid: c.is_paid,
        ids: [c.id],
      });
    }
  }
  return out;
}

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ mine?: string; hot?: string; page?: string }>;
}) {
  const params = await searchParams;
  const mineOnly = params.mine === '1';
  const hotOnly = params.hot === '1';
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // --- Полка пользователя ---
  let shelfFirebaseIds: Set<string> = new Set();
  let hasShelf = false;
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('bookmarks')
      .eq('id', user.id)
      .maybeSingle();
    if (profile) {
      const bm = (profile as { bookmarks?: unknown }).bookmarks;
      if (Array.isArray(bm)) {
        shelfFirebaseIds = new Set(bm as string[]);
      } else if (bm && typeof bm === 'object') {
        shelfFirebaseIds = new Set(Object.keys(bm as Record<string, unknown>));
      }
      hasShelf = shelfFirebaseIds.size > 0;
    }
  }

  // --- mineOnly: ограничиваем по novel_id из полки ---
  let shelfNovelIds: number[] | null = null;
  if (mineOnly && shelfFirebaseIds.size > 0) {
    const { data: shelfNovels } = await supabase
      .from('novels')
      .select('id')
      .in('firebase_id', Array.from(shelfFirebaseIds));
    shelfNovelIds = (shelfNovels ?? []).map((n) => n.id);
  }

  // --- Главы ---
  const nowIso = new Date().toISOString();
  let q = supabase
    .from('chapters')
    .select('id, chapter_number, is_paid, published_at, novel_id', { count: 'exact' })
    .not('published_at', 'is', null)
    .lte('published_at', nowIso)
    .order('published_at', { ascending: false, nullsFirst: false })
    .range(from, to);
  if (mineOnly) {
    if (shelfNovelIds === null) {
      q = q.eq('novel_id', -1);
    } else if (shelfNovelIds.length > 0) {
      q = q.in('novel_id', shelfNovelIds);
    }
  }
  const { data: chaptersData, count } = await q;
  const chapters = (chaptersData ?? []) as ChapterFeedRow[];

  // --- Группировка подряд идущих глав одной новеллы в один батч ---
  const batches = groupConsecutive(chapters);

  // --- Novel-info одним запросом ---
  const novelIds = Array.from(new Set(batches.map((b) => b.novelId)));
  const { data: novelsData } = novelIds.length
    ? await supabase
        .from('novels_view')
        .select('id, firebase_id, title, author, cover_url, chapter_count, translator_id')
        .in('id', novelIds)
        .eq('moderation_status', 'published')
    : { data: [] as Array<{ id: number; firebase_id: string; title: string; author: string | null; cover_url: string | null; chapter_count: number | null; translator_id: string | null }> };
  const novelMap = new Map((novelsData ?? []).map((n) => [n.id, n]));

  // --- «Горячие» — ≥3 глав за 3 дня (для значка 🔥) ---
  const hotWindowIso = new Date(Date.now() - HOT_WINDOW_DAYS * 86_400_000).toISOString();
  const { data: recentChaps } = novelIds.length
    ? await supabase
        .from('chapters')
        .select('novel_id, published_at')
        .in('novel_id', novelIds)
        .gte('published_at', hotWindowIso)
    : { data: [] as Array<{ novel_id: number; published_at: string }> };
  const burstCount = new Map<number, number>();
  for (const c of recentChaps ?? []) {
    burstCount.set(c.novel_id, (burstCount.get(c.novel_id) ?? 0) + 1);
  }
  const hotNovels = new Set(
    Array.from(burstCount.entries())
      .filter(([, n]) => n >= HOT_MIN_CHAPTERS)
      .map(([id]) => id)
  );

  // --- Slug переводчика ---
  const translatorIds = Array.from(
    new Set(
      (novelsData ?? [])
        .map((n) => n.translator_id)
        .filter((x): x is string => !!x)
    )
  );
  const { data: translatorsData } = translatorIds.length
    ? await supabase
        .from('profiles')
        .select('id, translator_slug, user_name')
        .in('id', translatorIds)
    : { data: [] as Array<{ id: string; translator_slug: string | null; user_name: string | null }> };
  const translatorSlugMap = new Map(
    (translatorsData ?? []).map((t) => [t.id, t.translator_slug ?? t.user_name ?? ''])
  );

  // --- hotOnly фильтрует уже после группировки ---
  const displayed = hotOnly
    ? batches.filter((b) => hotNovels.has(b.novelId))
    : batches;

  const totalCount = count ?? chapters.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const pageUrl = (n: number) => {
    const usp = new URLSearchParams();
    if (mineOnly) usp.set('mine', '1');
    if (hotOnly) usp.set('hot', '1');
    if (n > 1) usp.set('page', String(n));
    const qs = usp.toString();
    return qs ? `/feed?${qs}` : '/feed';
  };

  return (
    <main className="container section">
      <div className="admin-breadcrumbs">
        <Link href="/">Главная</Link>
        <span>/</span>
        <span>Лента</span>
      </div>

      <header className="section-head" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 32 }}>
          Лента обновлений
        </h1>
        <p style={{ margin: 0, color: 'var(--ink-mute)', fontSize: 14 }}>
          Все новые главы в одном потоке. Подряд идущие главы одной новеллы группируются.
        </p>
      </header>

      <FeedFilter mineOnly={mineOnly} hotOnly={hotOnly} hasShelf={hasShelf} />

      {mineOnly && !hasShelf && (
        <div className="empty-state">
          <p>В закладках пусто. Добавь новеллы в закладки, и они появятся здесь.</p>
          <Link href="/catalog" className="btn btn-ghost">К каталогу</Link>
        </div>
      )}

      {displayed.length === 0 ? (
        !mineOnly || hasShelf ? (
          <div className="empty-state">
            <p>Под эти фильтры ничего не подошло.</p>
            <Link href="/feed" className="btn btn-ghost">Сбросить фильтры</Link>
          </div>
        ) : null
      ) : (
        <div className="feed-list">
          {displayed.map((b) => {
            const n = novelMap.get(b.novelId);
            if (!n) return null;
            const isHot = hotNovels.has(b.novelId);
            const hotN = burstCount.get(b.novelId) ?? 0;
            const cover = getCoverUrl(n.cover_url);
            const slug = n.translator_id ? translatorSlugMap.get(n.translator_id) : null;
            const onShelf = shelfFirebaseIds.has(n.firebase_id);
            // Кликом ведём на самую раннюю главу в батче — пользователь
            // дочитает в порядке выпуска.
            const navChapter = b.oldestChapter;

            return (
              <div key={`b-${b.novelId}-${b.latestAt}`} className="feed-item feed-item--batch">
                <Link
                  href={`/novel/${n.firebase_id}`}
                  className="feed-cover"
                  aria-label={n.title}
                >
                  {cover ? (
                    <img src={cover} alt={n.title} />
                  ) : (
                    <div className="placeholder p1" style={{ fontSize: 9 }}>
                      {n.title}
                    </div>
                  )}
                </Link>
                <div className="feed-body">
                  <div className="feed-item-top">
                    <Link
                      href={`/novel/${n.firebase_id}`}
                      className="feed-title"
                    >
                      {n.title}
                    </Link>
                    {isHot && (
                      <span className="feed-hot" title={`${hotN} глав за 3 дня`}>
                        🔥 серия × {hotN}
                      </span>
                    )}
                    {onShelf && !mineOnly && (
                      <span className="feed-shelf-mark" title="В твоих закладках">★</span>
                    )}
                  </div>
                  <div className="feed-chapter">
                    <Link
                      href={`/novel/${n.firebase_id}/${navChapter}`}
                      className="feed-chapter-link"
                    >
                      Глава {b.latestChapter}
                      {b.count > 1 && (
                        <span className="feed-chapter-extra">
                          {' '}+ ещё {b.count - 1}{' '}
                          {pluralRu(b.count - 1, 'глава', 'главы', 'глав')}
                        </span>
                      )}
                    </Link>
                    {b.hasPaid && (
                      <span className="tag-price paid" style={{ marginLeft: 10 }}>
                        есть платные
                      </span>
                    )}
                  </div>
                  <div className="feed-meta">
                    <span>{timeAgo(b.latestAt)}</span>
                    <span>·</span>
                    {slug ? (
                      <Link href={`/t/${slug}`} className="feed-author">
                        {n.author || 'Переводчик'}
                      </Link>
                    ) : (
                      <span>{n.author || 'Переводчик'}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <nav className="pagination">
          {page > 1 && <Link href={pageUrl(page - 1)} className="page-link">← Назад</Link>}
          <span className="page-ellipsis">стр. {page} из {totalPages}</span>
          {page < totalPages && <Link href={pageUrl(page + 1)} className="page-link">Вперёд →</Link>}
        </nav>
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
