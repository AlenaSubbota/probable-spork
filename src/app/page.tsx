import { createClient } from '@/utils/supabase/server';
import WeeklyHero from '@/components/WeeklyHero';
import GenreChips from '@/components/GenreChips';
import NovelCard from '@/components/NovelCard';
import ContinueReadingShelf, { type ContinueItem } from '@/components/ContinueReadingShelf';
import MyShelfStrip, { type ShelfItem } from '@/components/MyShelfStrip';
import Link from 'next/link';
import { getCoverUrl } from '@/lib/format';

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Параллельно получаем всё что нужно для страницы
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

  // Находим новеллу для последней главы
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

  // Агрегируем жанры из всех новелл
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

  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('last_read, bookmarks')
      .eq('id', user.id)
      .maybeSingle();

    if (profile) {
      // «Продолжить чтение» из last_read: { [novel_id]: { novelId, chapterId, timestamp } }
      type LastReadEntry = { novelId: number; chapterId: number; timestamp: string };
      const lastRead = (profile.last_read || {}) as Record<string, LastReadEntry>;
      const lastReadEntries = Object.values(lastRead)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 10);

      if (lastReadEntries.length > 0) {
        const novelIds = lastReadEntries.map((e) => e.novelId);
        const { data: continueNovels } = await supabase
          .from('novels')
          .select('id, firebase_id, title, cover_url')
          .in('id', novelIds);

        const novelMap: Record<string, { firebase_id: string; title: string; cover_url: string | null }> = {};
        for (const n of continueNovels ?? []) {
          novelMap[String(n.id)] = n;
        }

        for (const entry of lastReadEntries) {
          const novel = novelMap[String(entry.novelId)];
          if (!novel) continue;
          continueItems.push({
            firebase_id: novel.firebase_id,
            title: novel.title,
            cover_url: novel.cover_url,
            chapterNumber: entry.chapterId,
            totalChapters: null,
            lastReadAt: entry.timestamp,
          });
        }
      }

      // «Моя полка» из bookmarks: { [firebase_id]: status } или массив firebase_id
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
      <ContinueReadingShelf items={continueItems} />

      <GenreChips genres={topGenres} total={allNovelsRaw?.length ?? 0} />

      {/* Секция: Популярное */}
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
              flagText={novel.average_rating > 4.8 ? 'HOT' : undefined}
            />
          ))}
        </div>
      </section>

      {/* Секция: Новые главы */}
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
              />
            );
          })}
        </div>
      </section>
    </main>
  );
}
