import { createClient } from '@/utils/supabase/server';
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
import JournalStrip, { type JournalItem } from '@/components/home/JournalStrip';
import QuoteOfTheDay, { type QuoteItem } from '@/components/home/QuoteOfTheDay';
import TrendingNovels, { type TrendingNovel } from '@/components/home/TrendingNovels';
import StarOfTheWeek, { type StarOfTheWeekData } from '@/components/home/StarOfTheWeek';
import HeroGuest from '@/components/home/HeroGuest';
import TopOfWeek, { type TopOfWeekItem } from '@/components/home/TopOfWeek';
import CollectionsStrip, { type CollectionPreview } from '@/components/home/CollectionsStrip';
import PersonalRecs, { type RecommendedNovel } from '@/components/home/PersonalRecs';
import { COLLECTIONS } from '@/lib/collections';
import { MOODS, type MoodKey } from '@/lib/catalog';
import Link from 'next/link';
import { getCoverUrl, formatAuthorPrimary, pluralRu } from '@/lib/format';

const AGE_RE = /^\d{1,2}\+$/;

const FORGOTTEN_DAYS = 14;

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [
    { data: popularNovels },
    { data: recentNovels },
  ] = await Promise.all([
    supabase
      .from('novels_view')
      .select('*')
      .eq('moderation_status', 'published')
      .order('average_rating', { ascending: false })
      .limit(6),
    supabase
      .from('novels_view')
      .select('*')
      .eq('moderation_status', 'published')
      .order('latest_chapter_published_at', { ascending: false })
      .limit(12),
  ]);

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
      .not('type', 'in', '(article,review,interview)')
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
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(6);
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
        .slice(0, 6);
    }
  } catch {
    // ok
  }

  // Раздел Stories выпилен по задаче от Алёны — освобождаем место под
  // другую фичу наверху. Данные и компонент StoriesStrip пока
  // оставлены на диске, но не импортятся и не рендерятся.

  // ---- Журнал: статьи / обзоры / интервью (типы 'article','review','interview') ----
  let journalItems: JournalItem[] = [];
  try {
    const { data: journalRaw } = await supabase
      .from('news_posts')
      .select('id, title, subtitle, cover_url, type, rubrics, published_at, created_at, is_published')
      .in('type', ['article', 'review', 'interview'])
      .eq('is_published', true)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(10);
    journalItems = (journalRaw ?? []).map((n) => ({
      id: n.id,
      title: n.title,
      subtitle: n.subtitle ?? null,
      cover_url: n.cover_url ?? null,
      type: n.type,
      rubrics: Array.isArray(n.rubrics) ? n.rubrics : [],
      published_at: n.published_at,
      created_at: n.created_at,
    }));
  } catch {
    // миграция 015 не накачена — блок тихо не рендерится
  }

  // ---- Цитаты дня: до 3-х случайных публичных цитат для community-полосы.
  // RPC возвращает по одной случайной — дёргаем три раза параллельно
  // и дедуплицируем по id. Если получилось меньше 3-х (мало цитат в БД)
  // — отрисуем сколько есть.
  let quotesOfTheDay: QuoteItem[] = [];
  try {
    const triple = await Promise.all([
      supabase.rpc('random_public_quote'),
      supabase.rpc('random_public_quote'),
      supabase.rpc('random_public_quote'),
    ]);
    const seen = new Set<number>();
    for (const { data } of triple) {
      const q = Array.isArray(data) ? data[0] : null;
      if (q && !seen.has(q.id)) {
        seen.add(q.id);
        quotesOfTheDay.push({
          id: q.id,
          quote_text: q.quote_text,
          chapter_number: q.chapter_number,
          author_name: q.author_name,
          novel_title: q.novel_title,
          novel_firebase_id: q.novel_firebase_id,
        });
      }
    }
  } catch {
    // миграция 014 не накачена
  }

  // ---- 🔥 Trending: топ-6 новелл по числу новых глав за неделю ----
  let trendingItems: TrendingNovel[] = [];
  try {
    const weekAgoIso = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const nowIso = new Date().toISOString();
    const { data: recentChapters } = await supabase
      .from('chapters')
      .select('novel_id, chapter_number, published_at')
      .not('published_at', 'is', null)
      .lte('published_at', nowIso)
      .gte('published_at', weekAgoIso);
    // Группируем по novel_id: count + max(chapter_number)
    const agg = new Map<number, { count: number; last: number }>();
    for (const c of recentChapters ?? []) {
      const cur = agg.get(c.novel_id) ?? { count: 0, last: 0 };
      cur.count += 1;
      if (c.chapter_number > cur.last) cur.last = c.chapter_number;
      agg.set(c.novel_id, cur);
    }
    // Топ-6 по числу новых глав (≥2, чтобы одиночная глава не считалась трендом)
    const topIds = Array.from(agg.entries())
      .filter(([, v]) => v.count >= 2)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 6)
      .map(([id]) => id);
    if (topIds.length > 0) {
      const { data: trendingNovelsData } = await supabase
        .from('novels_view')
        .select('id, firebase_id, title, cover_url')
        .in('id', topIds)
        .eq('moderation_status', 'published');
      const orderMap = new Map(topIds.map((id, i) => [id, i]));
      trendingItems = (trendingNovelsData ?? [])
        .map((n) => ({
          firebase_id: n.firebase_id,
          title: n.title,
          cover_url: n.cover_url,
          new_chapters: agg.get(n.id)?.count ?? 0,
          latest_chapter_number: agg.get(n.id)?.last ?? 0,
        }))
        .sort((a, b) => {
          // Сохраняем порядок из topIds
          const oa = orderMap.get(
            (trendingNovelsData ?? []).find((x) => x.firebase_id === a.firebase_id)?.id ?? -1
          ) ?? 999;
          const ob = orderMap.get(
            (trendingNovelsData ?? []).find((x) => x.firebase_id === b.firebase_id)?.id ?? -1
          ) ?? 999;
          return oa - ob;
        });
    }
  } catch {
    // молча — блок не критичен
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

  // ---- Звезда недели — RPC из миграции 042 ----
  // Если за последние 7 дней никто ничего не набрал — блок не рендерится.
  let starOfTheWeek: StarOfTheWeekData | null = null;
  try {
    const { data: starRows } = await supabase.rpc('star_translator_of_the_week');
    const row = Array.isArray(starRows) ? starRows[0] : null;
    if (row) {
      const r = row as {
        translator_id: string;
        user_name: string | null;
        translator_slug: string | null;
        translator_display_name: string | null;
        translator_avatar_url: string | null;
        avatar_url: string | null;
        new_subscribers: number;
        chapters_published: number;
        coins_earned: number;
      };
      starOfTheWeek = {
        translator_id: r.translator_id,
        slug: r.translator_slug || r.user_name || null,
        display_name: r.translator_display_name || r.user_name || 'Переводчик',
        avatar_url: r.translator_avatar_url || r.avatar_url || null,
        new_subscribers: r.new_subscribers ?? 0,
        chapters_published: r.chapters_published ?? 0,
        coins_earned: r.coins_earned ?? 0,
      };
    }
  } catch {
    // миграция 042 ещё не накачена — блок не покажется
  }

  // ---- Топ недели по рейтингу: новеллы с самым активным голосованием
  // ---- за последние 7 дней. В отличие от «На волне» — это про качество.
  let topOfWeek: TopOfWeekItem[] = [];
  try {
    const weekAgoIso = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data: weekRatings } = await supabase
      .from('novel_ratings')
      .select('novel_id, rating')
      .gte('created_at', weekAgoIso);
    const agg = new Map<number, { sum: number; count: number }>();
    for (const r of weekRatings ?? []) {
      const cur = agg.get(r.novel_id) ?? { sum: 0, count: 0 };
      cur.sum += Number(r.rating) || 0;
      cur.count += 1;
      agg.set(r.novel_id, cur);
    }
    // Минимум 3 голоса, чтобы случайная пятёрка не выводила в топ.
    const ranked = Array.from(agg.entries())
      .filter(([, v]) => v.count >= 3)
      .map(([id, v]) => ({ id, avg: v.sum / v.count, count: v.count }))
      .sort((a, b) => b.avg - a.avg || b.count - a.count)
      .slice(0, 6);
    if (ranked.length > 0) {
      const ids = ranked.map((r) => r.id);
      const { data: nv } = await supabase
        .from('novels_view')
        .select('id, firebase_id, title, cover_url')
        .in('id', ids)
        .eq('moderation_status', 'published');
      const byId = new Map((nv ?? []).map((n) => [n.id, n]));
      topOfWeek = ranked
        .map((r) => {
          const n = byId.get(r.id);
          if (!n) return null;
          return {
            firebase_id: n.firebase_id,
            title: n.title,
            cover_url: n.cover_url,
            weekly_avg: r.avg,
            weekly_votes: r.count,
          } satisfies TopOfWeekItem;
        })
        .filter((x): x is TopOfWeekItem => x !== null);
    }
  } catch {
    // молча — блок не критичен
  }

  // ---- Пул топ-новелл для превью подборок и настроений ----
  // Один запрос → партиционируем в JS под несколько секций сразу.
  type PoolNovel = {
    id: number;
    firebase_id: string;
    title: string;
    cover_url: string | null;
    genres: unknown;
    average_rating: number | null;
    country: string | null;
  };
  let novelPool: PoolNovel[] = [];
  try {
    const { data: pool } = await supabase
      .from('novels_view')
      .select('id, firebase_id, title, cover_url, genres, average_rating, country')
      .eq('moderation_status', 'published')
      .order('average_rating', { ascending: false, nullsFirst: false })
      .limit(150);
    novelPool = (pool ?? []) as PoolNovel[];
  } catch {
    // ok — превью просто будут пустыми
  }

  const poolMatchesGenres = (n: PoolNovel, genres: string[]): boolean => {
    if (!Array.isArray(n.genres)) return false;
    const set = new Set(genres);
    for (const g of n.genres) {
      if (typeof g === 'string' && set.has(g)) return true;
    }
    return false;
  };

  // ---- Featured-подборки из БД (создают переводчики и админ).
  // Идут первыми в списке. Обложки берём отдельной выборкой, потому
  // что новеллы из DB-подборок могут не попадать в novelPool (он
  // ограничен топ-150 по рейтингу).
  type DbFeaturedCollection = {
    id: number;
    slug: string;
    title: string;
    tagline: string | null;
    emoji: string | null;
    novel_ids: unknown;
  };
  let dbCollectionsPreview: CollectionPreview[] = [];
  try {
    const { data: dbColls } = await supabase
      .from('collections')
      .select('id, slug, title, tagline, emoji, novel_ids')
      .eq('is_published', true)
      .eq('is_featured', true)
      .order('updated_at', { ascending: false })
      .limit(8);
    const allDbColls = (dbColls ?? []) as DbFeaturedCollection[];
    const allCoverIds = new Set<string>();
    for (const c of allDbColls) {
      const ids = Array.isArray(c.novel_ids)
        ? (c.novel_ids as unknown[]).filter((x): x is string => typeof x === 'string')
        : [];
      for (const id of ids.slice(0, 3)) allCoverIds.add(id);
    }
    let coverById = new Map<string, { firebase_id: string; cover_url: string | null; title: string }>();
    if (allCoverIds.size > 0) {
      const { data: coverRows } = await supabase
        .from('novels')
        .select('firebase_id, cover_url, title')
        .in('firebase_id', Array.from(allCoverIds));
      coverById = new Map(
        (coverRows ?? []).map((n) => [
          n.firebase_id as string,
          {
            firebase_id: n.firebase_id as string,
            cover_url: (n.cover_url ?? null) as string | null,
            title: n.title as string,
          },
        ])
      );
    }
    dbCollectionsPreview = allDbColls
      .map((c) => {
        const ids = Array.isArray(c.novel_ids)
          ? (c.novel_ids as unknown[]).filter((x): x is string => typeof x === 'string')
          : [];
        const covers = ids
          .slice(0, 3)
          .map((id) => coverById.get(id))
          .filter((x): x is { firebase_id: string; cover_url: string | null; title: string } => !!x);
        return {
          slug: c.slug,
          title: c.title,
          tagline: c.tagline ?? '',
          emoji: c.emoji ?? '✦',
          count: ids.length,
          covers,
        };
      })
      .filter((c) => c.count > 0);
  } catch {
    // миграция 073 не накачена — DB-подборок просто не покажем
  }

  // ---- Статические подборки из lib/collections.ts: добиваем хвост.
  const dbSlugs = new Set(dbCollectionsPreview.map((c) => c.slug));
  const staticCollectionsPreview: CollectionPreview[] = COLLECTIONS
    .filter((c) => !dbSlugs.has(c.slug))
    .map((c) => {
      let matches: PoolNovel[] = [];
      if (c.novelIds && c.novelIds.length > 0) {
        const ids = new Set(c.novelIds);
        matches = novelPool.filter((n) => ids.has(n.firebase_id));
      } else if (c.smartFilter) {
        const f = c.smartFilter;
        matches = novelPool.filter((n) => {
          if (f.country && n.country !== f.country) return false;
          if (f.minRating !== undefined && (n.average_rating ?? 0) < f.minRating)
            return false;
          if (f.genres && f.genres.length > 0 && !poolMatchesGenres(n, f.genres))
            return false;
          return true;
        });
      }
      return {
        slug: c.slug,
        title: c.title,
        tagline: c.tagline,
        emoji: c.emoji,
        count: matches.length,
        covers: matches.slice(0, 3).map((n) => ({
          firebase_id: n.firebase_id,
          cover_url: n.cover_url,
          title: n.title,
        })),
      };
    })
    .filter((c) => c.count > 0);

  // DB-подборки идут первыми, статика — следом.
  const collectionsPreview: CollectionPreview[] = [
    ...dbCollectionsPreview,
    ...staticCollectionsPreview,
  ];

  // ---- Превью настроений: до 3 обложек на каждое настроение ----
  const moodPreviews: Record<MoodKey, { covers: string[] }> = {} as Record<
    MoodKey,
    { covers: string[] }
  >;
  for (const m of MOODS) {
    const matches = novelPool.filter((n) => {
      if ((n.average_rating ?? 0) < m.minRating) return false;
      return poolMatchesGenres(n, m.genres);
    });
    moodPreviews[m.key] = {
      covers: matches
        .slice(0, 3)
        .map((n) => n.cover_url)
        .filter((x): x is string => !!x),
    };
  }

  // ---- Личные рекомендации: «похоже на то, что ты недавно читал» ----
  // Используем коллаборативный RPC по последней прочитанной новелле.
  let personalRecs: RecommendedNovel[] = [];
  let personalRecsBaseTitle: string | null = null;
  if (user) {
    try {
      const { data: profile2 } = await supabase
        .from('profiles')
        .select('last_read, bookmarks')
        .eq('id', user.id)
        .maybeSingle();
      type LastReadEntry = { novelId: number; chapterId: number; timestamp: string };
      const lastRead = (profile2?.last_read || {}) as Record<string, LastReadEntry>;
      const mostRecent = Object.values(lastRead).sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )[0];
      if (mostRecent) {
        const { data: simRows } = await supabase.rpc('get_similar_novels_by_readers', {
          p_novel_id: mostRecent.novelId,
          p_limit: 8,
        });
        const { data: baseNovel } = await supabase
          .from('novels')
          .select('title')
          .eq('id', mostRecent.novelId)
          .maybeSingle();
        personalRecsBaseTitle = baseNovel?.title ?? null;

        // Исключаем то, что уже в закладках или уже читал.
        const bookmarks = profile2?.bookmarks;
        const bookmarkSet = new Set<string>(
          Array.isArray(bookmarks)
            ? (bookmarks as string[])
            : bookmarks && typeof bookmarks === 'object'
            ? Object.keys(bookmarks as Record<string, unknown>)
            : []
        );
        const readNovelIds = new Set(Object.values(lastRead).map((v) => v.novelId));

        type SimRow = {
          firebase_id: string;
          title: string;
          cover_url: string | null;
          average_rating: number | null;
          match_count: number;
          id: number;
        };
        personalRecs = ((simRows ?? []) as SimRow[])
          .filter((r) => !readNovelIds.has(r.id) && !bookmarkSet.has(r.firebase_id))
          .slice(0, 6)
          .map((r) => ({
            firebase_id: r.firebase_id,
            title: r.title,
            cover_url: r.cover_url,
            average_rating: r.average_rating ? Number(r.average_rating) : null,
            match_reason: `${r.match_count} читателей оценили обе`,
          }));
      }
    } catch {
      // молча
    }
  }

  return (
    <main>
      {/* Гостевой герой — только для незалогиненного посетителя */}
      {!user && <HeroGuest />}

      {/* HERO: что реально читают прямо сейчас */}
      <ReadingNow items={readingNowItems} totalReadersNow={totalReadersNow} />

      <MyShelfStrip items={shelfItems} totalCount={shelfTotal} isLoggedIn={!!user} />

      {/* Новые главы — самое свежее наверху, плотной сеткой */}
      <section className="container section">
        <div className="section-head">
          <h2>Новые главы</h2>
          <Link href="/feed" className="more">Вся лента →</Link>
        </div>
        <div className="novel-grid novel-grid-dense novel-grid-tight">
          {recentNovels?.map((novel, index) => {
            const date = novel.latest_chapter_published_at
              ? new Date(novel.latest_chapter_published_at).toLocaleDateString('ru-RU')
              : 'Недавно';
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
                metaInfo={date}
                rating={novel.average_rating ? Number(novel.average_rating).toFixed(1) : '—'}
                coverUrl={getCoverUrl(novel.cover_url)}
                placeholderClass={`p${(index % 8) + 1}`}
                placeholderText={
                  novel.title.length > 10
                    ? novel.title.substring(0, 10) + '…'
                    : novel.title
                }
                chapterCount={novel.chapter_count}
              />
            );
          })}
        </div>
      </section>

      {/* ★ Топ недели — по рейтингу за последние 7 дней (про качество) */}
      <TopOfWeek items={topOfWeek} />

      {/* 🔥 На волне — по скорости выхода глав (про активность) */}
      <TrendingNovels items={trendingItems} />

      {/* ✦ Подборки от редакции */}
      <CollectionsStrip items={collectionsPreview} />

      {/* Личные рекомендации (только если есть, на что опереться) */}
      <PersonalRecs items={personalRecs} basedOnTitle={personalRecsBaseTitle} />

      {/* Выбор по настроению — теперь с превью обложек */}
      <MoodPicker previews={moodPreviews} />

      {/* Забытое и продолжить — личные секции залогиненного юзера */}
      <ForgottenNovels items={forgottenItems} />
      <ContinueReadingShelf items={continueItems} />

      {/* Цитаты дня — 3 коротких карточки в полосу, читателей и оригинал.
          Атмосферная вставка между утилитарными блоками. */}
      {quotesOfTheDay.length > 0 && (
        <section className="container section">
          <div className="section-head">
            <h2>На полях книг</h2>
            <span className="more" style={{ cursor: 'default' }}>
              {quotesOfTheDay.length === 1 ? 'цитата дня' : 'цитаты дня'}
            </span>
          </div>
          <div className="quotes-strip">
            {quotesOfTheDay.map((q) => (
              <QuoteOfTheDay key={q.id} quote={q} compact />
            ))}
          </div>
        </section>
      )}

      {/* ✦ Звезда недели — переводчик с максимальным ростом */}
      {starOfTheWeek && <StarOfTheWeek data={starOfTheWeek} />}

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

      {/* Журнал, новости, лента комментариев — «редакторская» зона */}
      <JournalStrip items={journalItems} />
      <LatestNews items={latestNews} unreadCount={unreadNewsCount} />
      <CommentsFeed comments={commentsFeed} />

      {/* Популярное */}
      <section className="container section">
        <div className="section-head">
          <h2>Популярное</h2>
          <Link href="/catalog" className="more">Смотреть все →</Link>
        </div>
        <div className="novel-grid novel-grid-tight">
          {popularNovels?.map((novel, index) => {
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
                metaInfo={`${novel.rating_count || 0} ${pluralRu(novel.rating_count || 0, 'оценка', 'оценки', 'оценок')}`}
                rating={novel.average_rating ? Number(novel.average_rating).toFixed(1) : '—'}
                coverUrl={getCoverUrl(novel.cover_url)}
                placeholderClass={`p${(index % 8) + 1}`}
                placeholderText={
                  novel.title.length > 10
                    ? novel.title.substring(0, 10) + '…'
                    : novel.title
                }
                chapterCount={novel.chapter_count}
                flagText={novel.average_rating > 4.8 ? 'HOT' : undefined}
              />
            );
          })}
        </div>
      </section>

    </main>
  );
}
