import { createClient } from '@/utils/supabase/server';
import WeeklyHero from '@/components/WeeklyHero';
import GenreChips from '@/components/GenreChips';
import NovelCard from '@/components/NovelCard';
import MoodPicker from '@/components/MoodPicker';
import ContinueReadingShelf, { type ContinueItem } from '@/components/ContinueReadingShelf';
import MyShelfStrip, { type ShelfItem } from '@/components/MyShelfStrip';
import ForgottenNovels, { type ForgottenItem } from '@/components/ForgottenNovels';
import LatestNews from '@/components/news/LatestNews';
import type { NewsItem } from '@/components/news/NewsCard';
import Link from 'next/link';
import { getCoverUrl } from '@/lib/format';

const FORGOTTEN_DAYS = 14;

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: newChaptersCount },
    { count: totalChaptersCount },
    { count: totalNovelsCount },
    { data: latestChapterRaw },
    { data: allNovelsRaw },
    { data: popularNovels },
    { data: recentNovels },
  ] = await Promise.all([
    supabase
      .from('chapters')
      .select('*', { count: 'exact', head: true })
      .gte('published_at', weekAgo),
    supabase
      .from('chapters')
      .select('*', { count: 'exact', head: true }),
    supabase
      .from('novels')
      .select('*', { count: 'exact', head: true }),
    supabase
      .from('chapters')
      .select('chapter_number, novel_id')
      .order('published_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('novels_view')
      .select('id, firebase_id, title, cover_url, genres'),
    supabase
      .from('novels_view')
      .select('*')
      .order('average_rating', { ascending: false })
      .limit(6),
    supabase
      .from('novels_view')
      .select('*')
      .order('latest_chapter_published_at', { ascending: false })
      .limit(6),
  ]);

  // Последняя глава
  let latestChapter: {
    novelTitle: string;
    novelFirebaseId: string;
    chapterNumber: number;
    chapterTitle: null;
  } | null = null;

  if (latestChapterRaw?.novel_id) {
    const { data: latestNovel } = await supabase
      .from('novels')
      .select('firebase_id, title')
      .eq('id', latestChapterRaw.novel_id)
      .maybeSingle();

    if (latestNovel) {
      latestChapter = {
        novelTitle: latestNovel.title,
        novelFirebaseId: latestNovel.firebase_id,
        chapterNumber: latestChapterRaw.chapter_number,
        chapterTitle: null,
      };
    }
  }

  // Жанры
  const genreMap: Record<string, number> = {};
  allNovelsRaw?.forEach((n) => {
    const gs = n.genres;
    if (Array.isArray(gs)) {
      gs.forEach((g: string) => {
        genreMap[g] = (genreMap[g] || 0) + 1;
      });
    }
  });
  const topGenres = Object.entries(genreMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));

  // Данные залогиненного пользователя
  let continueItems: ContinueItem[] = [];
  let shelfItems: ShelfItem[] = [];
  let shelfTotal = 0;
  let forgottenItems: ForgottenItem[] = [];

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('last_read, bookmarks')
      .eq('id', user.id)
      .maybeSingle();

    if (profile) {
      type LastReadEntry = { novelId: number; chapterId: number; timestamp: string };
      const lastRead = (profile.last_read || {}) as Record<string, LastReadEntry>;
      const lastReadValues = Object.values(lastRead);

      // --- Продолжить чтение (последние 10 по времени) ---
      const recentReads = [...lastReadValues]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 10);

      // --- Забытое (14+ дней назад, <90% прогресса) ---
      const forgottenThreshold = Date.now() - FORGOTTEN_DAYS * 24 * 60 * 60 * 1000;
      const forgottenCandidates = lastReadValues
        .filter((v) => new Date(v.timestamp).getTime() < forgottenThreshold)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 10);

      // Собираем все novel_id одним запросом
      const allIds = Array.from(
        new Set([
          ...recentReads.map((v) => v.novelId),
          ...forgottenCandidates.map((v) => v.novelId),
        ])
      );

      let novelById: Record<string, { id: number; firebase_id: string; title: string; cover_url: string | null; chapter_count: number }> = {};
      if (allIds.length > 0) {
        const { data: novelsData } = await supabase
          .from('novels_view')
          .select('id, firebase_id, title, cover_url, chapter_count')
          .in('id', allIds);
        for (const n of novelsData ?? []) {
          novelById[String(n.id)] = n;
        }
      }

      for (const entry of recentReads) {
        const n = novelById[String(entry.novelId)];
        if (!n) continue;
        continueItems.push({
          firebase_id: n.firebase_id,
          title: n.title,
          cover_url: n.cover_url,
          chapterNumber: entry.chapterId,
          totalChapters: n.chapter_count ?? null,
          lastReadAt: entry.timestamp,
        });
      }

      for (const entry of forgottenCandidates) {
        const n = novelById[String(entry.novelId)];
        if (!n || !n.chapter_count) continue;
        const progress = n.chapter_count > 0 ? entry.chapterId / n.chapter_count : 1;
        if (progress >= 0.9) continue; // уже почти дочитал
        const days = Math.floor(
          (Date.now() - new Date(entry.timestamp).getTime()) / (24 * 60 * 60 * 1000)
        );
        forgottenItems.push({
          firebase_id: n.firebase_id,
          novel_id: n.id,
          title: n.title,
          cover_url: n.cover_url,
          chapterNumber: entry.chapterId,
          totalChapters: n.chapter_count,
          lastReadAt: entry.timestamp,
          daysForgotten: days,
        });
        if (forgottenItems.length >= 4) break;
      }

      // --- Полка (bookmarks) ---
      const bookmarks = profile.bookmarks;
      let bookmarkIds: string[] = [];
      if (Array.isArray(bookmarks)) {
        bookmarkIds = bookmarks as string[];
      } else if (bookmarks && typeof bookmarks === 'object') {
        bookmarkIds = Object.keys(bookmarks as Record<string, unknown>);
      }
      shelfTotal = bookmarkIds.length;

      if (bookmarkIds.length > 0) {
        const { data: bookmarkNovels } = await supabase
          .from('novels')
          .select('firebase_id, title, cover_url')
          .in('firebase_id', bookmarkIds.slice(0, 12));

        shelfItems = (bookmarkNovels || []).map((n) => ({
          firebase_id: n.firebase_id,
          title: n.title,
          cover_url: n.cover_url,
        }));
      }
    }
  }

  // ---- Новости: до 3-х свежих + подсчёт непрочитанных для шильдика ----
  let latestNews: NewsItem[] = [];
  let unreadNewsCount = 0;
  try {
    const { data: newsRaw } = await supabase
      .from('news_posts')
      .select('id, title, body, type, is_pinned, created_at, published_at, attached_novel_id')
      .eq('is_published', true)
      .order('is_pinned', { ascending: false })
      .order('published_at', { ascending: false })
      .limit(3);

    const attachedIds = Array.from(
      new Set(
        (newsRaw ?? [])
          .map((n) => n.attached_novel_id)
          .filter((x): x is number => !!x)
      )
    );
    let novelMap = new Map<
      number,
      { firebase_id: string; title: string; cover_url: string | null }
    >();
    if (attachedIds.length > 0) {
      const { data: novelsAttached } = await supabase
        .from('novels')
        .select('id, firebase_id, title, cover_url')
        .in('id', attachedIds);
      for (const n of novelsAttached ?? []) {
        novelMap.set(n.id, {
          firebase_id: n.firebase_id,
          title: n.title,
          cover_url: n.cover_url,
        });
      }
    }
    latestNews = (newsRaw ?? []).map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      type: n.type,
      is_pinned: !!n.is_pinned,
      created_at: n.created_at,
      published_at: n.published_at,
      attached_novel_id: n.attached_novel_id,
      attached_novel: n.attached_novel_id ? novelMap.get(n.attached_novel_id) ?? null : null,
    }));

    if (user) {
      const { data: unread } = await supabase.rpc('unread_news_count');
      if (typeof unread === 'number') unreadNewsCount = unread;
    }
  } catch {
    // миграция 009 не накачена — блок новостей просто не показывается
  }

  return (
    <main>
      <WeeklyHero
        newChaptersThisWeek={newChaptersCount ?? 0}
        totalChapters={totalChaptersCount ?? 0}
        totalNovels={totalNovelsCount ?? 0}
        latestChapter={latestChapter}
        translators={[
          { name: 'Алёна', count: newChaptersCount ?? 0, tint: 'coffee' },
        ]}
      />

      <MyShelfStrip items={shelfItems} totalCount={shelfTotal} />

      {/* Новости админа */}
      <LatestNews items={latestNews} unreadCount={unreadNewsCount} />

      {/* Киллер-фича #1 — настроение */}
      <MoodPicker />

      {/* Киллер-фича #3 — забытое */}
      <ForgottenNovels items={forgottenItems} />

      <ContinueReadingShelf items={continueItems} />

      <GenreChips genres={topGenres} total={allNovelsRaw?.length ?? 0} />

      {/* Популярное */}
      <section className="container section">
        <div className="section-head">
          <h2>Популярное</h2>
          <Link href="/catalog" className="more">Смотреть все →</Link>
        </div>
        <div className="novel-grid">
          {popularNovels?.map((novel, index) => (
            <NovelCard
              key={novel.id}
              id={novel.firebase_id}
              title={novel.title}
              translator={novel.author || 'Алёна'}
              metaInfo={`${novel.rating_count || 0} оценок`}
              rating={novel.average_rating ? Number(novel.average_rating).toFixed(1) : '—'}
              coverUrl={getCoverUrl(novel.cover_url)}
              placeholderClass={`p${(index % 8) + 1}`}
              placeholderText={novel.title.substring(0, 10) + '...'}
              chapterCount={novel.chapter_count}
              flagText={novel.average_rating > 4.8 ? 'HOT' : undefined}
            />
          ))}
        </div>
      </section>

      {/* Новые главы */}
      <section className="container section">
        <div className="section-head">
          <h2>Новые главы</h2>
          <Link href="/feed" className="more">Вся лента →</Link>
        </div>
        <div className="novel-grid">
          {recentNovels?.map((novel, index) => {
            const date = novel.latest_chapter_published_at
              ? new Date(novel.latest_chapter_published_at).toLocaleDateString('ru-RU')
              : 'Недавно';
            return (
              <NovelCard
                key={novel.id}
                id={novel.firebase_id}
                title={novel.title}
                translator={novel.author || 'Алёна'}
                metaInfo={date}
                rating={novel.average_rating ? Number(novel.average_rating).toFixed(1) : '—'}
                coverUrl={getCoverUrl(novel.cover_url)}
                placeholderClass={`p${(index % 8) + 1}`}
                placeholderText={novel.title.substring(0, 10) + '...'}
                chapterCount={novel.chapter_count}
              />
            );
          })}
        </div>
      </section>
    </main>
  );
}
