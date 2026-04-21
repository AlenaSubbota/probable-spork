import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import BookmarkTabs, { type BookmarkTab } from '@/components/bookmarks/BookmarkTabs';
import BookmarkCard, { type BookmarkItem } from '@/components/bookmarks/BookmarkCard';

const RECENT_DAYS = 14;
const COLD_DAYS = 90;
const DONE_PROGRESS = 0.9;
const DROPPED_PROGRESS = 0.5;

function classify(
  lastReadTs: string | null,
  lastChapter: number | null,
  totalChapters: number,
  isCompleted: boolean
): BookmarkTab {
  const progress = lastChapter && totalChapters ? lastChapter / totalChapters : 0;

  if (!lastReadTs) return 'planned';

  const ageDays = (Date.now() - new Date(lastReadTs).getTime()) / 86_400_000;

  if (progress >= DONE_PROGRESS || (isCompleted && progress >= 0.8)) return 'done';
  if (ageDays <= RECENT_DAYS) return 'reading';
  if (ageDays > COLD_DAYS && progress < DROPPED_PROGRESS) return 'dropped';
  return 'paused';
}

export default async function BookmarksPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const params = await searchParams;
  const activeTab: BookmarkTab =
    (['reading', 'paused', 'planned', 'done', 'dropped'] as const).find(
      (t) => t === params.tab
    ) ?? 'all';

  // Читаем профиль
  const { data: profileRaw } = await supabase
    .from('profiles')
    .select('bookmarks, last_read')
    .eq('id', user.id)
    .maybeSingle();

  const profile = (profileRaw ?? {}) as {
    bookmarks?: unknown;
    last_read?: Record<string, { novelId: number; chapterId: number; timestamp: string }> | null;
  };

  // Извлекаем firebase_id и статус из закладок
  const bmRaw = profile.bookmarks;
  const bookmarkMap = new Map<string, string>();
  if (Array.isArray(bmRaw)) {
    for (const id of bmRaw as string[]) bookmarkMap.set(id, 'reading');
  } else if (bmRaw && typeof bmRaw === 'object') {
    for (const [k, v] of Object.entries(bmRaw as Record<string, string>)) {
      bookmarkMap.set(k, String(v));
    }
  }

  const firebaseIds = Array.from(bookmarkMap.keys());

  if (firebaseIds.length === 0) {
    return (
      <main className="container section">
        <h1 style={{ fontFamily: 'var(--font-serif)', margin: '20px 0 10px' }}>
          Моя библиотека
        </h1>
        <p style={{ color: 'var(--ink-mute)', marginBottom: 24 }}>
          Здесь появятся твои закладки.
        </p>
        <div className="empty-state">
          <p>В закладках пусто. Открой каталог и добавь новеллы в полку.</p>
          <Link href="/catalog" className="btn btn-primary">
            К каталогу
          </Link>
        </div>
      </main>
    );
  }

  // Подтягиваем новеллы
  const { data: novelsData } = await supabase
    .from('novels_view')
    .select('id, firebase_id, title, author, cover_url, chapter_count, is_completed')
    .in('firebase_id', firebaseIds);

  const lastRead = profile.last_read ?? {};

  // Строим items с автокатегоризацией
  const items: BookmarkItem[] = (novelsData ?? []).map((n) => {
    const total = n.chapter_count ?? 0;
    const lrEntry = lastRead[String(n.id)] ?? null;
    const lastChapter = lrEntry?.chapterId ?? null;
    const lastTs = lrEntry?.timestamp ?? null;
    const status = classify(lastTs, lastChapter, total, !!n.is_completed);
    const fresh = total > 0 && lastChapter != null ? Math.max(0, total - lastChapter) : 0;
    return {
      firebase_id: n.firebase_id,
      novel_id: n.id,
      title: n.title,
      cover_url: n.cover_url,
      author: n.author,
      status,
      chapter_count: total,
      last_chapter_read: lastChapter,
      last_read_at: lastTs,
      fresh_chapters: fresh,
    };
  });

  // Счётчики по вкладкам
  const counts: Record<BookmarkTab, number> = {
    all: items.length,
    reading: 0, paused: 0, planned: 0, done: 0, dropped: 0,
  };
  for (const it of items) counts[it.status] += 1;

  // Фильтрация под активную вкладку + сортировка
  const filtered = activeTab === 'all'
    ? [...items]
    : items.filter((i) => i.status === activeTab);

  // Сортировка: свежее первое (по последней активности), planned — по названию
  filtered.sort((a, b) => {
    if (a.status === 'planned' && b.status === 'planned') return a.title.localeCompare(b.title);
    const at = a.last_read_at ? new Date(a.last_read_at).getTime() : 0;
    const bt = b.last_read_at ? new Date(b.last_read_at).getTime() : 0;
    return bt - at;
  });

  // Общая статистика для хедера
  const totalReading = counts.reading;
  const totalFresh = items.reduce((s, i) => s + (i.status !== 'done' ? i.fresh_chapters : 0), 0);

  return (
    <main className="container section">
      <div className="bookmarks-head">
        <div>
          <h1>Моя библиотека</h1>
          <p className="bookmarks-head-sub">
            {items.length}{' '}
            {plural(items.length, 'новелла', 'новеллы', 'новелл')} ·{' '}
            {totalReading} в активном чтении
            {totalFresh > 0 && (
              <> · <span style={{ color: 'var(--accent)', fontWeight: 600 }}>✨ {totalFresh} новых глав</span></>
            )}
          </p>
        </div>
      </div>

      <BookmarkTabs active={activeTab} counts={counts} />

      {filtered.length === 0 ? (
        <div className="empty-state">
          <p>В этой категории пока пусто.</p>
          <Link href="/bookmarks" className="btn btn-ghost">
            Показать все
          </Link>
        </div>
      ) : (
        <div className="bookmarks-grid">
          {filtered.map((item) => (
            <BookmarkCard key={item.firebase_id} item={item} />
          ))}
        </div>
      )}
    </main>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
