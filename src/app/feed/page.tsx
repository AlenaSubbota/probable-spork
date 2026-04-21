import Link from 'next/link';
import { createClient } from '@/utils/supabase/server';
import { getCoverUrl, timeAgo } from '@/lib/format';
import FeedFilter from '@/components/feed/FeedFilter';

const PAGE_SIZE = 40;
const HOT_WINDOW_DAYS = 3;
const HOT_MIN_CHAPTERS = 3;

interface ChapterFeedRow {
  id: number;
  chapter_number: number;
  is_paid: boolean;
  published_at: string;
  novel_id: number;
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

  // --- Определяем полку пользователя ---
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

  // --- Основной запрос: главы с новеллами ---
  // Если mineOnly и полка непустая — ограничиваем по novel_id из полки (через два запроса).
  let shelfNovelIds: number[] | null = null;
  if (mineOnly && shelfFirebaseIds.size > 0) {
    const { data: shelfNovels } = await supabase
      .from('novels')
      .select('id')
      .in('firebase_id', Array.from(shelfFirebaseIds));
    shelfNovelIds = (shelfNovels ?? []).map((n) => n.id);
  }

  // Скрываем черновики (published_at IS NULL) и будущие публикации.
  const nowIsoFeed = new Date().toISOString();
  let chaptersQuery = supabase
    .from('chapters')
    .select('id, chapter_number, is_paid, published_at, novel_id', { count: 'exact' })
    .not('published_at', 'is', null)
    .lte('published_at', nowIsoFeed)
    .order('published_at', { ascending: false, nullsFirst: false })
    .range(from, to);
  if (mineOnly) {
    if (shelfNovelIds === null) {
      // mineOnly но полка пустая → ничего не показываем
      chaptersQuery = chaptersQuery.eq('novel_id', -1);
    } else if (shelfNovelIds.length > 0) {
      chaptersQuery = chaptersQuery.in('novel_id', shelfNovelIds);
    }
  }

  const { data: chaptersData, count } = await chaptersQuery;
  const chapters = (chaptersData ?? []) as ChapterFeedRow[];

  // --- Подтягиваем novel-info одним запросом ---
  // Читатели в ленте видят только published — остальные главы просто не рендерим.
  const novelIds = Array.from(new Set(chapters.map((c) => c.novel_id)));
  const { data: novelsData } = novelIds.length
    ? await supabase
        .from('novels_view')
        .select('id, firebase_id, title, author, cover_url, chapter_count, translator_id')
        .in('id', novelIds)
        .eq('moderation_status', 'published')
    : { data: [] as Array<{ id: number; firebase_id: string; title: string; author: string | null; cover_url: string | null; chapter_count: number | null; translator_id: string | null }> };

  const novelMap = new Map((novelsData ?? []).map((n) => [n.id, n]));

  // --- Детектим «горячие» новеллы: ≥3 глав за 3 дня ---
  // Запрос на последние главы для каждой новеллы из list, чтобы посчитать burst
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

  // --- Подтягиваем slug переводчика для ссылки ---
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

  // --- Отфильтровываем, если hotOnly ---
  const displayed = hotOnly
    ? chapters.filter((c) => hotNovels.has(c.novel_id))
    : chapters;

  const totalCount = count ?? displayed.length;
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
      <header className="section-head" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 32 }}>
          Лента обновлений
        </h1>
        <p style={{ margin: 0, color: 'var(--ink-mute)', fontSize: 14 }}>
          Все новые главы в одном потоке. Ты сам решаешь — читать свежее от всех или только свою полку.
        </p>
      </header>

      <FeedFilter mineOnly={mineOnly} hotOnly={hotOnly} hasShelf={hasShelf} />

      {mineOnly && !hasShelf && (
        <div className="empty-state">
          <p>В закладках пусто. Добавь новеллы в закладки, и они появятся здесь.</p>
          <Link href="/catalog" className="btn btn-ghost">
            К каталогу
          </Link>
        </div>
      )}

      {displayed.length === 0 ? (
        !mineOnly || hasShelf ? (
          <div className="empty-state">
            <p>Под эти фильтры ничего не подошло.</p>
            <Link href="/feed" className="btn btn-ghost">
              Сбросить фильтры
            </Link>
          </div>
        ) : null
      ) : (
        <div className="feed-list">
          {displayed.map((c) => {
            const n = novelMap.get(c.novel_id);
            if (!n) return null;
            const isHot = hotNovels.has(c.novel_id);
            const hotN = burstCount.get(c.novel_id) ?? 0;
            const cover = getCoverUrl(n.cover_url);
            const slug = n.translator_id ? translatorSlugMap.get(n.translator_id) : null;
            const readingMin = 15; // среднее; реальные цифры — внутри главы
            const onShelf = shelfFirebaseIds.has(n.firebase_id);

            return (
              <Link
                key={c.id}
                href={`/novel/${n.firebase_id}/${c.chapter_number}`}
                className="feed-item"
              >
                <div className="feed-cover">
                  {cover ? (
                    <img src={cover} alt={n.title} />
                  ) : (
                    <div className="placeholder p1" style={{ fontSize: 9 }}>
                      {n.title}
                    </div>
                  )}
                </div>
                <div className="feed-body">
                  <div className="feed-item-top">
                    <span className="feed-title">{n.title}</span>
                    {isHot && (
                      <span className="feed-hot" title={`${hotN} глав за 3 дня`}>
                        🔥 серия × {hotN}
                      </span>
                    )}
                    {onShelf && !mineOnly && (
                      <span className="feed-shelf-mark" title="В твоих закладках">
                        ★
                      </span>
                    )}
                  </div>
                  <div className="feed-chapter">
                    Глава {c.chapter_number}
                    {c.is_paid && <span className="tag-price paid" style={{ marginLeft: 10 }}>10 монет</span>}
                  </div>
                  <div className="feed-meta">
                    <span>{timeAgo(c.published_at)}</span>
                    <span>·</span>
                    {slug ? (
                      <Link
                        href={`/t/${slug}`}
                        className="feed-author"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {n.author || 'Переводчик'}
                      </Link>
                    ) : (
                      <span>{n.author || 'Переводчик'}</span>
                    )}
                    <span>·</span>
                    <span>~{readingMin} мин чтения</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <nav className="pagination">
          {page > 1 && <Link href={pageUrl(page - 1)} className="page-link">← Назад</Link>}
          <span className="page-ellipsis">
            стр. {page} из {totalPages}
          </span>
          {page < totalPages && <Link href={pageUrl(page + 1)} className="page-link">Вперёд →</Link>}
        </nav>
      )}
    </main>
  );
}
