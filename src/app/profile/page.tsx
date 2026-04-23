import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import UserAvatar from '@/components/UserAvatar';
import QuoteCollection, { type Quote } from '@/components/profile/QuoteCollection';
import ReadingStreak, { type ActivityDay } from '@/components/profile/ReadingStreak';
import BookDiet from '@/components/profile/BookDiet';
import ReadingTotals from '@/components/profile/ReadingTotals';
import LogoutButton from '@/components/auth/LogoutButton';

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
    avatar_url?: string | null;
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
  let readNovels: Array<{
    id: number;
    title: string;
    genres: string[];
    country: string | null;
    translator_id: string | null;
  }> = [];
  if (readNovelIds.length > 0) {
    const { data } = await supabase
      .from('novels_view')
      .select('id, title, genres, country, translator_id')
      .in('id', readNovelIds.map((s) => parseInt(s, 10)).filter(Boolean));
    readNovels = (data ?? []).map((n) => ({
      id: n.id,
      title: n.title,
      genres: Array.isArray(n.genres) ? (n.genres as string[]) : [],
      country: (n as { country?: string | null }).country ?? null,
      translator_id: (n as { translator_id?: string | null }).translator_id ?? null,
    }));
  }

  // ---- Агрегат «Моя статистика» ----
  // Берём самые поздние chapterId по каждой новелле из last_read,
  // суммируем, переводим в часы ≈ × 8 мин.
  const lr = (profile.last_read ?? {}) as Record<
    string,
    { novelId?: number; chapterId?: number; timestamp?: string }
  >;
  let totalChaptersRead = 0;
  const chaptersByTranslator = new Map<string, number>();
  const novelsStarted = readNovels.length;
  for (const [novelIdStr, entry] of Object.entries(lr)) {
    const ch = entry?.chapterId;
    if (!ch || ch <= 0) continue;
    totalChaptersRead += ch;
    const novelInfo = readNovels.find((n) => String(n.id) === novelIdStr);
    if (novelInfo?.translator_id) {
      chaptersByTranslator.set(
        novelInfo.translator_id,
        (chaptersByTranslator.get(novelInfo.translator_id) ?? 0) + ch
      );
    }
  }
  const estHoursRead = Math.round((totalChaptersRead * 8) / 60);

  // Любимый переводчик — у кого больше всех прочитано
  let favoriteTranslator: {
    name: string;
    slug: string | null;
    chapters: number;
  } | null = null;
  if (chaptersByTranslator.size > 0) {
    const [topId, topChapters] = Array.from(chaptersByTranslator.entries()).sort(
      (a, b) => b[1] - a[1]
    )[0];
    // public_profiles (мигр. 040) — для чужих переводчиков RLS на profiles
    // ничего не отдал бы, и любимый переводчик схлопнулся бы в null.
    const { data: topProfile } = await supabase
      .from('public_profiles')
      .select('translator_display_name, translator_slug, user_name')
      .eq('id', topId)
      .maybeSingle();
    const p = topProfile as {
      translator_display_name?: string | null;
      translator_slug?: string | null;
      user_name?: string | null;
    } | null;
    if (p) {
      favoriteTranslator = {
        name: p.translator_display_name || p.user_name || 'Переводчик',
        slug: p.translator_slug || p.user_name || null,
        chapters: topChapters,
      };
    }
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
      .select('id, novel_id, chapter_number, quote_text, note, created_at, is_public')
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
          is_public: !!q.is_public,
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

  // ---- Per-translator кошельки (мигр. 045) ----
  // Каждый переводчик продаёт свои монеты читателю — у одного и того же
  // юзера может быть несколько балансов (300 у Алёны, 150 у Маши, 0 у Ани).
  // Старый «единый» coin_balance (profiles.coin_balance) оставляем как
  // legacy-показатель только для совместимости с tene.
  let wallets: Array<{
    translator_id: string;
    name: string;
    slug: string | null;
    avatar_url: string | null;
    balance: number;
  }> = [];
  try {
    const { data } = await supabase.rpc('my_translator_wallets');
    if (Array.isArray(data)) {
      wallets = (data as Array<{
        translator_id: string;
        user_name: string | null;
        translator_slug: string | null;
        translator_display_name: string | null;
        translator_avatar_url: string | null;
        avatar_url: string | null;
        balance: number;
      }>).map((w) => ({
        translator_id: w.translator_id,
        name: w.translator_display_name || w.user_name || 'Переводчик',
        slug: w.translator_slug || w.user_name || null,
        avatar_url: w.translator_avatar_url || w.avatar_url || null,
        balance: w.balance,
      }));
    }
  } catch {
    // миграция 045 не накачена — блок просто не появится
  }
  const totalCoins = wallets.reduce((s, w) => s + w.balance, 0);

  // ---- Активные подписки (счётчик + последние 3 переводчика) ----
  // Раньше карточка «Подписки» всегда показывала «—», читатель не видел,
  // на кого подписан. Тянем активные subscriptions + имя переводчика.
  let activeSubsCount = 0;
  let activeSubs: Array<{
    id: number;
    translator_id: string;
    name: string;
    slug: string | null;
    avatar_url: string | null;
    expires_at: string | null;
  }> = [];
  try {
    const { data: subsRaw } = await supabase
      .from('subscriptions')
      .select('id, translator_id, expires_at, started_at')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('started_at', { ascending: false });
    const all = (subsRaw ?? []) as Array<{
      id: number;
      translator_id: string;
      expires_at: string | null;
      started_at: string | null;
    }>;
    activeSubsCount = all.length;
    if (all.length > 0) {
      const ids = Array.from(new Set(all.map((s) => s.translator_id)));
      const { data: subProfiles } = await supabase
        .from('public_profiles')
        .select('id, user_name, translator_slug, translator_display_name, translator_avatar_url, avatar_url')
        .in('id', ids);
      const tMap = new Map(
        (subProfiles ?? []).map((t) => [
          t.id as string,
          t as {
            id: string;
            user_name: string | null;
            translator_slug: string | null;
            translator_display_name: string | null;
            translator_avatar_url: string | null;
            avatar_url: string | null;
          },
        ])
      );
      activeSubs = all.slice(0, 3).map((s) => {
        const tr = tMap.get(s.translator_id);
        return {
          id: s.id,
          translator_id: s.translator_id,
          name: tr?.translator_display_name || tr?.user_name || 'Переводчик',
          slug: tr?.translator_slug || tr?.user_name || null,
          avatar_url: tr?.translator_avatar_url || tr?.avatar_url || null,
          expires_at: s.expires_at,
        };
      });
    }
  } catch {
    // мигр. 001 ещё не накачена — пропускаем
  }

  const displayName =
    profile.translator_display_name ?? profile.user_name ?? profile.email ?? 'Читатель';

  return (
    <main className="container section">
      {/* Шапка профиля */}
      <div className="profile-hero">
        <UserAvatar avatarUrl={profile.avatar_url} name={displayName} size={84} />
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
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href="/profile/settings" className="btn btn-ghost">
            ⚙ Настройки
          </Link>
          {isTranslator && (
            <Link href="/admin" className="btn btn-ghost">
              Админка
            </Link>
          )}
          <LogoutButton />
        </div>
      </div>

      {/* Статистика */}
      <div className="card-grid-3">
        <Link href="/profile/topup" className="stat-card stat-card--link">
          <div className="label">Монеты</div>
          <div className="value">
            {totalCoins > 0 ? totalCoins : (coinBalance ?? 0)} <small>всего</small>
          </div>
          <div className="stat-card-cta">
            {wallets.length > 0
              ? `у ${wallets.length} ${pluralTranslators(wallets.length)} →`
              : 'Как это работает →'}
          </div>
        </Link>
        <Link href="/bookmarks" className="stat-card stat-card--link">
          <div className="label">Закладок</div>
          <div className="value">{bookmarksCount}</div>
          <div className="stat-card-cta">В библиотеку →</div>
        </Link>
        <Link href="/profile/subscriptions" className="stat-card stat-card--link">
          <div className="label">Подписки</div>
          <div className="value">{activeSubsCount}</div>
          <div className="stat-card-cta">Управлять →</div>
        </Link>
      </div>

      {wallets.length > 0 && (
        <section className="card wallets-section" style={{ marginTop: 14 }}>
          <h3 style={{ margin: '0 0 10px' }}>Мои монеты по переводчикам</h3>
          <p style={{ margin: '0 0 12px', color: 'var(--ink-mute)', fontSize: 12.5 }}>
            У каждого переводчика — свой кошелёк: монеты одного не работают
            на новеллах другого. Chaptify деньги не проводит, переводчик
            принимает их напрямую (Boosty / Tribute / карта).
          </p>
          <div className="wallets-grid">
            {wallets.map((w) => {
              const initial = w.name.trim().charAt(0).toUpperCase() || '?';
              const href = w.slug ? `/t/${w.slug}` : `/u/${w.translator_id}`;
              return (
                <Link key={w.translator_id} href={href} className="wallet-card">
                  <div className="wallet-card-avatar">
                    {w.avatar_url ? (
                      <img src={w.avatar_url} alt="" />
                    ) : (
                      <span>{initial}</span>
                    )}
                  </div>
                  <div>
                    <div className="wallet-card-name">{w.name}</div>
                    <div className="wallet-card-balance">
                      {w.balance} <small>монет</small>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {activeSubs.length > 0 && (
        <section className="card" style={{ marginTop: 14 }}>
          <h3 style={{ margin: '0 0 10px' }}>Я подписан_а на</h3>
          <div className="profile-subs-strip">
            {activeSubs.map((s) => {
              const initial = s.name.trim().charAt(0).toUpperCase() || '?';
              const href = s.slug ? `/t/${s.slug}` : `/u/${s.translator_id}`;
              const days = s.expires_at
                ? Math.ceil((new Date(s.expires_at).getTime() - Date.now()) / 86_400_000)
                : null;
              return (
                <Link key={s.id} href={href} className="profile-subs-strip-item">
                  <div className="profile-subs-strip-avatar">
                    {s.avatar_url ? (
                      <img src={s.avatar_url} alt="" />
                    ) : (
                      <span>{initial}</span>
                    )}
                  </div>
                  <div>
                    <div className="profile-subs-strip-name">{s.name}</div>
                    <div className="profile-subs-strip-meta">
                      {days !== null
                        ? days > 0
                          ? `ещё ${days} дн.`
                          : 'истекла'
                        : 'бессрочно'}
                    </div>
                  </div>
                </Link>
              );
            })}
            {activeSubsCount > activeSubs.length && (
              <Link href="/profile/subscriptions" className="profile-subs-strip-more">
                + ещё {activeSubsCount - activeSubs.length}
              </Link>
            )}
          </div>
        </section>
      )}

      {/* Агрегат: глав прочитано / часов / любимый переводчик */}
      <ReadingTotals
        chaptersRead={totalChaptersRead}
        novelsStarted={novelsStarted}
        estHoursRead={estHoursRead}
        favoriteTranslator={favoriteTranslator}
      />

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

function pluralTranslators(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return 'переводчиков';
  if (mod10 === 1) return 'переводчика';
  if (mod10 >= 2 && mod10 <= 4) return 'переводчиков';
  return 'переводчиков';
}
