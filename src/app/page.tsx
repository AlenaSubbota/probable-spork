import { createClient } from '@/utils/supabase/server';
import GenreChips from '@/components/GenreChips';
import NovelCard from '@/components/NovelCard';
import MoodPicker from '@/components/MoodPicker';
import ContinueReadingShelf, { type ContinueItem } from '@/components/ContinueReadingShelf';
import MyShelfStrip, { type ShelfItem } from '@/components/MyShelfStrip';
import ForgottenNovels, { type ForgottenItem } from '@/components/ForgottenNovels';
import LatestNews from '@/components/news/LatestNews';
import type { NewsItem } from '@/components/news/NewsCard';
import ReadingNow, { type ReadingNowItem } from '@/components/home/ReadingNow';
import CommentsFeed, { type CommentFeedItem } from '@/components/home/CommentsFeed';
import NovelPoll, { type PollOptionResult } from '@/components/home/NovelPoll';
import Link from 'next/link';
import { getCoverUrl } from '@/lib/format';

const AGE_RE = /^\d{1,2}\+$/;

const FORGOTTEN_DAYS = 14;

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [
    { data: allNovelsRaw },
    { data: popularNovels },
    { data: recentNovels },
  ] = await Promise.all([
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

  // ---- «Сейчас читают»: юзеры с last_read за последние 30 минут ----
  let readingNowItems: ReadingNowItem[] = [];
  let totalReadersNow = 0;
  try {
    const freshSinceMs = Date.now() - 30 * 60 * 1000;
    // Берём до 200 свежих профилей, у кого last_read модифицирован недавно
    const { data: activeProfiles } = await supabase
      .from('profiles')
      .select('id, last_read')
      .not('last_read', 'is', null)
      .limit(200);

    // Считаем уникальных юзеров по novel_id, берём самый свежий chapter_id
    const counter = new Map<
      number,
      { readers: Set<string>; lastChapter: number }
    >();
    for (const row of activeProfiles ?? []) {
      const lr = (row as { last_read?: Record<string, { novelId: number; chapterId: number; timestamp: string }> }).last_read;
      if (!lr) continue;
      for (const entry of Object.values(lr)) {
        if (!entry?.timestamp) continue;
        const ts = new Date(entry.timestamp).getTime();
        if (Number.isNaN(ts) || ts < freshSinceMs) continue;
        const nid = entry.novelId;
        let bucket = counter.get(nid);
        if (!bucket) {
          bucket = { readers: new Set(), lastChapter: entry.chapterId };
          counter.set(nid, bucket);
        }
        bucket.readers.add(row.id as string);
        if (entry.chapterId > bucket.lastChapter) bucket.lastChapter = entry.chapterId;
      }
    }

    const novelIds = Array.from(counter.keys());
    if (novelIds.length > 0) {
      const { data: novelsData } = await supabase
        .from('novels')
        .select('id, firebase_id, title, cover_url')
        .in('id', novelIds);
      const allReaderIds = new Set<string>();
      for (const b of counter.values()) for (const r of b.readers) allReaderIds.add(r);
      totalReadersNow = allReaderIds.size;

      readingNowItems = (novelsData ?? [])
        .map((n) => {
          const b = counter.get(n.id)!;
          return {
            novel_id: n.id,
            firebase_id: n.firebase_id,
            title: n.title,
            cover_url: n.cover_url,
            readers_now: b.readers.size,
            last_chapter_read: b.lastChapter,
          };
        })
        .sort((a, b) => b.readers_now - a.readers_now)
        .slice(0, 6);
    }
  } catch {
    // молча — блок не критичен
  }

  // ---- Лента свежих комментариев (без спойлеров на главной) ----
  let commentsFeed: CommentFeedItem[] = [];
  try {
    const { data: comments } = await supabase
      .from('comments')
      .select('id, user_name, text, created_at, novel_id, chapter_number')
      .order('created_at', { ascending: false })
      .limit(10);
    if (comments && comments.length > 0) {
      const novelIds = Array.from(new Set(comments.map((c) => c.novel_id)));
      const { data: novelsForComments } = await supabase
        .from('novels')
        .select('id, firebase_id, title')
        .in('id', novelIds);
      const novelMap = new Map(
        (novelsForComments ?? []).map((n) => [n.id, n])
      );
      commentsFeed = comments
        .map((c) => {
          const n = novelMap.get(c.novel_id);
          if (!n) return null;
          return {
            id: c.id,
            user_name: c.user_name,
            text: c.text,
            created_at: c.created_at,
            novel_firebase_id: n.firebase_id,
            novel_title: n.title,
            chapter_number: c.chapter_number,
          } satisfies CommentFeedItem;
        })
        .filter((x): x is CommentFeedItem => x !== null)
        .slice(0, 8);
    }
  } catch {
    // ok
  }

  // ---- Активный опрос (голосование за новую новеллу) ----
  let pollData: {
    id: number;
    title: string;
    description: string | null;
    options: PollOptionResult[];
    myVoteOptionId: number | null;
  } | null = null;
  try {
    const { data: polls } = await supabase
      .from('polls')
      .select('id, title, description, ends_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1);
    const poll = polls?.[0];
    if (poll) {
      const [{ data: options }, { data: myVote }] = await Promise.all([
        supabase.rpc('poll_results', { p_poll: poll.id }),
        user
          ? supabase
              .from('poll_votes')
              .select('option_id')
              .eq('poll_id', poll.id)
              .eq('user_id', user.id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (Array.isArray(options)) {
        pollData = {
          id: poll.id,
          title: poll.title,
          description: poll.description ?? null,
          options: options as PollOptionResult[],
          myVoteOptionId:
            (myVote as { option_id?: number } | null)?.option_id ?? null,
        };
      }
    }
  } catch {
    // миграция 013 не накачена
  }

  return (
    <main>
      {/* HERO: что реально читают прямо сейчас */}
      <ReadingNow items={readingNowItems} totalReadersNow={totalReadersNow} />

      <MyShelfStrip items={shelfItems} totalCount={shelfTotal} />

      {/* Новости админа */}
      <LatestNews items={latestNews} unreadCount={unreadNewsCount} />

      {/* Выбор по настроению */}
      <MoodPicker />

      {/* Голосование за следующую новеллу */}
      {pollData && (
        <NovelPoll
          pollId={pollData.id}
          pollTitle={pollData.title}
          pollDescription={pollData.description}
          options={pollData.options}
          myVoteOptionId={pollData.myVoteOptionId}
          isAuthed={!!user}
        />
      )}

      {/* Забытое */}
      <ForgottenNovels items={forgottenItems} />

      <ContinueReadingShelf items={continueItems} />

      {/* Лента свежих комментариев */}
      <CommentsFeed comments={commentsFeed} />

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
