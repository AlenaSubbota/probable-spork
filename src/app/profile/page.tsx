import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import QuoteCollection, { type Quote } from '@/components/profile/QuoteCollection';
import ReadingStreak, { type ActivityDay } from '@/components/profile/ReadingStreak';
import BookDiet from '@/components/profile/BookDiet';

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profileRaw } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  const profile = (profileRaw ?? {}) as {
    user_name?: string | null;
    role?: string;
    is_admin?: boolean;
    coin_balance?: number | null;
    last_read?: Record<string, unknown> | null;
    bookmarks?: unknown;
    email?: string | null;
    translator_slug?: string | null;
    translator_display_name?: string | null;
  };

  const isAdmin = profile.is_admin === true || profile.role === 'admin';
  const isTranslator = isAdmin || profile.role === 'translator';

  // ---- Активность (стрик) ----
  let activity: ActivityDay[] = [];
  try {
    const { data } = await supabase.rpc('get_reading_activity', {
      p_user: null,
      p_days: 90,
    });
    if (Array.isArray(data)) {
      activity = (data as Array<{ day: string; chapters: number }>).map((d) => ({
        day: d.day,
        chapters: d.chapters,
      }));
    }
  } catch {
    // RPC ещё не существует, пропускаем стрик
  }

  // Если RPC нет — строим приблизительную активность из last_read
  if (activity.length === 0 && profile.last_read) {
    const lr = profile.last_read as Record<string, { timestamp?: string }>;
    const hits = new Map<string, number>();
    for (const v of Object.values(lr)) {
      if (!v?.timestamp) continue;
      const d = v.timestamp.slice(0, 10);
      hits.set(d, (hits.get(d) ?? 0) + 1);
    }
    const today = new Date();
    const out: ActivityDay[] = [];
    for (let i = 89; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      out.push({ day: iso, chapters: hits.get(iso) ?? 0 });
    }
    activity = out;
  }

  // ---- Прочитанные новеллы (для книжной диеты) ----
  const readNovelIds = Object.keys((profile.last_read ?? {}) as Record<string, unknown>);
  let readNovels: Array<{ id: number; title: string; genres: string[]; country: string | null }> = [];
  if (readNovelIds.length > 0) {
    const { data } = await supabase
      .from('novels_view')
      .select('id, title, genres, country')
      .in('id', readNovelIds.map((s) => parseInt(s, 10)).filter(Boolean));
    readNovels = (data ?? []).map((n) => ({
      id: n.id,
      title: n.title,
      genres: Array.isArray(n.genres) ? (n.genres as string[]) : [],
      country: (n as { country?: string | null }).country ?? null,
    }));
  }

  // ---- Подборки «Попробуй ещё» из непокрытых жанров ----
  let suggestions: Array<{
    firebase_id: string;
    title: string;
    average_rating: number | null;
    genres: string[];
    reason: string;
  }> = [];
  if (readNovels.length > 0) {
    const readGenres = new Set(readNovels.flatMap((n) => n.genres));

    const { data: allNovels } = await supabase
      .from('novels_view')
      .select('firebase_id, title, genres, average_rating, id')
      .not('firebase_id', 'in', `(${readNovelIds.map((id) => `'${id}'`).join(',') || "''"})`)
      .order('average_rating', { ascending: false })
      .limit(40);

    const readIdsSet = new Set(readNovels.map((n) => n.id));
    for (const n of allNovels ?? []) {
      if (readIdsSet.has(n.id)) continue;
      const gs = Array.isArray(n.genres) ? (n.genres as string[]) : [];
      const newGenre = gs.find((g) => !readGenres.has(g));
      if (!newGenre) continue;
      suggestions.push({
        firebase_id: n.firebase_id,
        title: n.title,
        average_rating: n.average_rating,
        genres: gs,
        reason: `Попробуй ${newGenre.toLowerCase()} — ещё не читал_а`,
      });
      if (suggestions.length >= 3) break;
    }
  }

  // ---- Цитаты ----
  let quotes: Quote[] = [];
  try {
    const { data } = await supabase
      .from('user_quotes')
      .select('id, novel_id, chapter_number, quote_text, note, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(200);
    const raw = data ?? [];
    if (raw.length > 0) {
      const novelIds = Array.from(new Set(raw.map((q) => q.novel_id)));
      const { data: novels } = await supabase
        .from('novels')
        .select('id, firebase_id, title')
        .in('id', novelIds);
      const novelMap = new Map(
        (novels ?? []).map((n) => [n.id, { firebase_id: n.firebase_id, title: n.title }])
      );
      for (const q of raw) {
        const nov = novelMap.get(q.novel_id);
        if (!nov) continue;
        quotes.push({
          id: q.id,
          novel_id: q.novel_id,
          chapter_number: q.chapter_number,
          quote_text: q.quote_text,
          note: q.note,
          created_at: q.created_at,
          novel_firebase_id: nov.firebase_id,
          novel_title: nov.title,
        });
      }
    }
  } catch {
    // таблица user_quotes ещё не создана — пропускаем
  }

  // ---- Счётчики ----
  const bookmarks = profile.bookmarks;
  const bookmarksCount = Array.isArray(bookmarks)
    ? bookmarks.length
    : bookmarks && typeof bookmarks === 'object'
    ? Object.keys(bookmarks as Record<string, unknown>).length
    : 0;

  const coinBalance = typeof profile.coin_balance === 'number' ? profile.coin_balance : null;

  const displayName =
    profile.translator_display_name ?? profile.user_name ?? profile.email ?? 'Читатель';
  const avatarInitial = displayName.trim().charAt(0).toUpperCase() || '?';

  return (
    <main className="container section">
      {/* Шапка профиля */}
      <div className="profile-hero">
        <div className="big-avatar">{avatarInitial}</div>
        <div style={{ flex: 1 }}>
          <h2>{displayName}</h2>
          <div className="handle">
            {profile.user_name && <>@{profile.user_name}</>}
            {isAdmin && (
              <span className="note" style={{ marginLeft: 10, fontSize: 10 }}>
                Админ
              </span>
            )}
            {!isAdmin && profile.role === 'translator' && (
              <span className="note" style={{ marginLeft: 10, fontSize: 10 }}>
                Переводчик
              </span>
            )}
          </div>
        </div>
        {isTranslator && (
          <Link href="/admin" className="btn btn-ghost">
            Админка
          </Link>
        )}
      </div>

      {/* Статистика */}
      <div className="card-grid-3">
        <div className="stat-card">
          <div className="label">Баланс</div>
          <div className="value">
            {coinBalance ?? 0} <small>монет</small>
          </div>
        </div>
        <div className="stat-card">
          <div className="label">Закладок</div>
          <div className="value">{bookmarksCount}</div>
        </div>
        <div className="stat-card">
          <div className="label">Сохранённых цитат</div>
          <div className="value">{quotes.length}</div>
        </div>
      </div>

      {/* Киллер-фича #2 — стрик чтения */}
      <ReadingStreak days={activity} />

      <div className="profile-two-col">
        {/* Киллер-фича #3 — книжная диета */}
        <BookDiet readNovels={readNovels} suggestions={suggestions} />

        {/* Моя полка */}
        <div className="card">
          <h3>Читаю сейчас</h3>
          {readNovels.length === 0 ? (
            <p style={{ color: 'var(--ink-mute)' }}>
              Открой каталог и начни читать — прогресс появится здесь.
            </p>
          ) : (
            <div className="reading-list-compact">
              {readNovels.slice(0, 6).map((n) => (
                <div key={n.id} className="reading-list-compact-row">
                  <span className="reading-title">{n.title}</span>
                  {n.genres[0] && <span className="note">{n.genres[0]}</span>}
                </div>
              ))}
              {readNovels.length > 6 && (
                <div className="form-hint">
                  …и ещё {readNovels.length - 6}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Киллер-фича #1 — моя коллекция цитат */}
      <QuoteCollection initial={quotes} />
    </main>
  );
}
