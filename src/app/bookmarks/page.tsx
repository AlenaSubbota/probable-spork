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

  // Извлекаем ключи закладок и статус. На стороне tene/Chaptify
  // bookmarks может приехать в трёх форматах:
  //   1) массив firebase_id-слагов: ["abc-xy12", "kim-romance-3a8e"];
  //   2) объект { firebase_id: status } (формат Chaptify-кнопки полки);
  //   3) объект { numeric_novel_id: true|status } — старый tene-формат,
  //      где ключи это PK таблицы novels (целое число строкой).
  // Поэтому сразу разделяем ключи на «слаги» и «числовые id»
  // и запросом ниже ищем оба варианта.
  const bmRaw = profile.bookmarks;
  const bookmarkMap = new Map<string, string>();
  if (Array.isArray(bmRaw)) {
    for (const id of bmRaw as unknown[]) {
      if (typeof id === 'string' && id.trim().length > 0) {
        bookmarkMap.set(id.trim(), 'reading');
      } else if (typeof id === 'number' && Number.isFinite(id)) {
        bookmarkMap.set(String(id), 'reading');
      }
    }
  } else if (bmRaw && typeof bmRaw === 'object') {
    for (const [k, v] of Object.entries(bmRaw as Record<string, unknown>)) {
      if (!k.trim()) continue;
      const status = typeof v === 'string' ? v : 'reading';
      bookmarkMap.set(k.trim(), status);
    }
  }

  const allKeys = Array.from(bookmarkMap.keys());
  // Числовые ключи — это PK новеллы из tene; строковые — firebase_id-слаги.
  const numericIds: number[] = [];
  const slugIds: string[] = [];
  for (const k of allKeys) {
    const asNum = Number(k);
    if (Number.isInteger(asNum) && asNum > 0 && /^\d+$/.test(k)) {
      numericIds.push(asNum);
    } else {
      slugIds.push(k);
    }
  }

  if (allKeys.length === 0) {
    return (
      <main className="container section">
        <div className="admin-breadcrumbs">
          <Link href="/">Главная</Link>
          <span>/</span>
          <span>Моя библиотека</span>
        </div>
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

  // Подтягиваем новеллы — сразу по обоим срезам ключей. Дубли (если
  // один ключ внезапно обнаружится и так и сяк) дедуплицируем по id.
  const novelsById = new Map<number, {
    id: number;
    firebase_id: string;
    title: string;
    author: string | null;
    cover_url: string | null;
    chapter_count: number | null;
    is_completed: boolean | null;
    translator_id: string | null;
  }>();
  if (slugIds.length > 0) {
    const { data } = await supabase
      .from('novels_view')
      .select('id, firebase_id, title, author, cover_url, chapter_count, is_completed, translator_id')
      .in('firebase_id', slugIds);
    for (const n of data ?? []) novelsById.set(n.id, n);
  }
  if (numericIds.length > 0) {
    const { data } = await supabase
      .from('novels_view')
      .select('id, firebase_id, title, author, cover_url, chapter_count, is_completed, translator_id')
      .in('id', numericIds);
    for (const n of data ?? []) novelsById.set(n.id, n);
  }
  const novelsData = Array.from(novelsById.values());

  // Slugs переводчиков — отдельным запросом, чтобы делать имя кликабельным.
  const translatorIds = Array.from(
    new Set(
      (novelsData ?? [])
        .map((n) => n.translator_id)
        .filter((x): x is string => !!x)
    )
  );
  const slugMap = new Map<string, string>();
  if (translatorIds.length > 0) {
    const { data: trProfiles } = await supabase
      .from('profiles')
      .select('id, translator_slug, user_name')
      .in('id', translatorIds);
    for (const p of trProfiles ?? []) {
      const slug = p.translator_slug || p.user_name;
      if (slug) slugMap.set(p.id, slug);
    }
  }

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
      translator_slug: n.translator_id ? slugMap.get(n.translator_id) ?? null : null,
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
      <div className="admin-breadcrumbs">
        <Link href="/">Главная</Link>
        <span>/</span>
        <span>Моя библиотека</span>
      </div>
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
