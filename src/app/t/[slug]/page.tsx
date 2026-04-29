import { createClient } from '@/utils/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import NovelCard from '@/components/NovelCard';
import ReleaseHeatmap from '@/components/translator/ReleaseHeatmap';
import TranslatorHandshake from '@/components/translator/TranslatorHandshake';
import TranslatorSpecialty from '@/components/translator/TranslatorSpecialty';
import TranslatorSchedule, {
  type PublicScheduleSlot,
} from '@/components/TranslatorSchedule';
import TributesWall, { type Tribute } from '@/components/translator/TributesWall';
import ThanksWall from '@/components/translator/ThanksWall';
import { fetchPublicThanksForTranslator, type ThanksWallRow } from '@/lib/thanks';
import RoadmapBoard, { type RoadmapItem } from '@/components/translator/RoadmapBoard';
import QuietBanner from '@/components/translator/QuietBanner';
import ProfileRatingBadge from '@/components/marketplace/ProfileRatingBadge';
import ProfileReviewsList from '@/components/marketplace/ProfileReviewsList';
import TranslatorFilmography, {
  type FilmographyEntry,
} from '@/components/translator/TranslatorFilmography';
import TranslatorWallet from '@/components/translator/TranslatorWallet';
import { getCoverUrl, cleanGenres } from '@/lib/format';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function TranslatorPage({ params }: PageProps) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user: viewer } } = await supabase.auth.getUser();

  // Устойчивый lookup переводчика. Почему столько вариантов:
  //  - Unicode-normalization: URL может приходить в NFD, БД хранить NFC (или наоборот)
  //  - Trailing/leading whitespace в user_name (частый случай у импорта из tene)
  //  - Case: у одних slug lowercase, у других — с заглавной
  //  - translator_slug приоритетнее user_name (если переводчик задал собственный)
  // PostgREST .or() со строкой ломается на пробелах/юникоде → используем .eq() / .ilike().
  const rawSlug = slug;
  const decoded = (() => {
    try { return decodeURIComponent(slug); } catch { return slug; }
  })();
  const candidates = Array.from(new Set([
    rawSlug,
    decoded,
    decoded.trim(),
    decoded.normalize('NFC'),
    decoded.normalize('NFD'),
    decoded.trim().normalize('NFC'),
  ]));

  let byField: Record<string, unknown> | null = null;

  // Все cross-user lookups идут через public_profiles (мигр. 040), потому
  // что на самой profiles стоит RLS «only own row». Без view возвращалось
  // бы всегда пусто для анонима / стороннего юзера → 404.

  // 1) По translator_slug (точное совпадение с любым вариантом)
  for (const v of candidates) {
    const { data } = await supabase
      .from('public_profiles').select('*').eq('translator_slug', v).maybeSingle();
    if (data) { byField = data; break; }
  }
  // 2) По user_name (точное совпадение с любым вариантом)
  if (!byField) {
    for (const v of candidates) {
      const { data } = await supabase
        .from('public_profiles').select('*').eq('user_name', v).maybeSingle();
      if (data) { byField = data; break; }
    }
  }
  // 3) Case-insensitive fallback по user_name (ilike с escape)
  if (!byField) {
    const escaped = decoded.replace(/([%_\\])/g, '\\$1');
    const { data } = await supabase
      .from('public_profiles').select('*').ilike('user_name', escaped).maybeSingle();
    if (data) byField = data;
  }

  if (!byField) {
    // Логируем в stdout — docker logs chaptify-web покажет, что пришло и что не нашлось.
    console.warn('[translator-page] not found', {
      rawSlug,
      decoded,
      candidates,
    });
  }

  const profile = byField as
    | {
        id: string;
        user_name: string | null;
        translator_slug: string | null;
        translator_display_name: string | null;
        translator_avatar_url: string | null;
        translator_about: string | null;
        payout_boosty_url: string | null;
        payout_tribute_channel: string | null;
        quiet_until: string | null;
        quiet_note: string | null;
      }
    | undefined;

  if (!profile) notFound();

  const displayName =
    profile.translator_display_name ||
    profile.user_name ||
    slug;

  const effectiveSlug = profile.translator_slug || profile.user_name || slug;

  // Новеллы переводчика:
  //  - Приоритет: novels.translator_id === profile.id (после миграции 001)
  //  - Fallback: novels.author = displayName (legacy)
  // Публичный профиль переводчика: показываем только опубликованные.
  const { data: novelsById } = await supabase
    .from('novels_view')
    .select('id, firebase_id, title, author, cover_url, genres, average_rating, rating_count, chapter_count, is_completed')
    .eq('translator_id', profile.id)
    .eq('moderation_status', 'published');

  let novels = novelsById ?? [];
  if (novels.length === 0 && profile.user_name) {
    const { data: novelsByAuthor } = await supabase
      .from('novels_view')
      .select('id, firebase_id, title, author, cover_url, genres, average_rating, rating_count, chapter_count, is_completed')
      .ilike('author', profile.user_name)
      .eq('moderation_status', 'published');
    novels = novelsByAuthor ?? [];
  }

  const novelsNormalized = novels.map((n) => ({
    id: n.id,
    firebase_id: n.firebase_id,
    title: n.title,
    author: n.author,
    cover_url: n.cover_url,
    genres: cleanGenres(n.genres),
    average_rating: n.average_rating as number | null,
    rating_count: n.rating_count as number | null,
    chapter_count: n.chapter_count as number | null,
    is_completed: n.is_completed as boolean | null,
  }));

  // ---- Фильмография: все участия переводчика в команде новелл (мигр. 034) ----
  // В «Все новеллы» выше — только где он главный (novels.translator_id==id).
  // Тут дополнительно показываем «где ещё помогал» — редактор, корректор,
  // иллюстратор и т.п. Одна строка на связь.
  let filmography: FilmographyEntry[] = [];
  try {
    const { data: teamRows } = await supabase
      .from('novel_translators')
      .select('novel_id, role, share_percent, note')
      .eq('user_id', profile.id);
    const rows = (teamRows ?? []) as Array<{
      novel_id: number;
      role: string;
      share_percent: number | null;
      note: string | null;
    }>;
    if (rows.length > 0) {
      const ids = Array.from(new Set(rows.map((r) => r.novel_id)));
      const { data: nns } = await supabase
        .from('novels_view')
        .select('id, firebase_id, title, cover_url, translator_id, moderation_status')
        .in('id', ids)
        .eq('moderation_status', 'published');
      const nMap = new Map(
        (nns ?? []).map((n) => [
          n.id as number,
          n as {
            id: number;
            firebase_id: string;
            title: string;
            cover_url: string | null;
            translator_id: string | null;
          },
        ])
      );
      filmography = rows.flatMap((r) => {
        const nv = nMap.get(r.novel_id);
        if (!nv) return [];
        return [{
          novel_id: nv.id,
          novel_firebase_id: nv.firebase_id,
          novel_title: nv.title,
          cover_url: nv.cover_url,
          role: r.role,
          is_main_translator: nv.translator_id === profile.id && r.role === 'translator',
          share_percent:
            typeof r.share_percent === 'number' ? r.share_percent : null,
          note: r.note,
        }];
      });
    }
  } catch {
    // миграция 034 не накачена — пропускаем блок
  }

  // ---- Heatmap выпусков (последние 180 дней) ----
  const novelIds = novelsNormalized.map((n) => n.id);
  let releaseDays: Array<{ day: string; chapters: number }> = [];
  if (novelIds.length > 0) {
    const sinceIso = new Date(Date.now() - 180 * 86_400_000).toISOString();
    const { data: releases } = await supabase
      .from('chapters')
      .select('published_at')
      .in('novel_id', novelIds)
      .gte('published_at', sinceIso);
    const hits = new Map<string, number>();
    for (const r of releases ?? []) {
      if (!r.published_at) continue;
      const day = r.published_at.slice(0, 10);
      hits.set(day, (hits.get(day) ?? 0) + 1);
    }
    // Разворачиваем в плотный ряд дней
    const out: Array<{ day: string; chapters: number }> = [];
    for (let i = 179; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      out.push({ day: iso, chapters: hits.get(iso) ?? 0 });
    }
    releaseDays = out;
  }

  // ---- Расписание (таблица 017) — показываем если есть слоты ----
  let scheduleSlots: PublicScheduleSlot[] = [];
  try {
    const { data: rawSlots } = await supabase
      .from('translator_schedule')
      .select('id, novel_id, day_of_week, time_of_day, note')
      .eq('translator_id', profile.id)
      .order('day_of_week', { ascending: true })
      .order('sort_order', { ascending: true });
    const ids = Array.from(new Set((rawSlots ?? []).map((s) => s.novel_id)));
    if (ids.length > 0) {
      const { data: scheduledNovels } = await supabase
        .from('novels')
        .select('id, firebase_id, title, cover_url, moderation_status')
        .in('id', ids);
      const nMap = new Map(
        (scheduledNovels ?? []).map((n) => [n.id, n])
      );
      scheduleSlots = (rawSlots ?? []).flatMap((s) => {
        const nv = nMap.get(s.novel_id);
        // Публичный профиль — только опубликованные новеллы.
        // Черновик на публике не светим, даже если переводчик его в расписание добавил.
        if (!nv || nv.moderation_status !== 'published') return [];
        return [
          {
            id: s.id,
            day_of_week: s.day_of_week,
            time_of_day: s.time_of_day,
            note: s.note,
            novel_firebase_id: nv.firebase_id,
            novel_title: nv.title,
            novel_cover_url: nv.cover_url,
          },
        ];
      });
    }
  } catch {
    // миграция 017 не накачена — блок не рендерится
  }
  // ISO: понедельник = 1, воскресенье = 7. Переводим в наш формат 0..6.
  const jsDow = new Date().getDay(); // 0=Sun…6=Sat
  const todayDow = (jsDow + 6) % 7;  // 0=Mon…6=Sun

  // ---- Платёжные методы переводчика + accepts_coins_for_chapters ----
  // Для блока «кошелёк у переводчика» и «Поддержать».
  let paymentMethods: Array<{
    id: number;
    provider: 'boosty' | 'tribute' | 'vk_donut' | 'patreon' | 'other';
    url: string;
    instructions: string | null;
  }> = [];
  try {
    const { data } = await supabase
      .from('translator_payment_methods')
      .select('id, provider, url, instructions')
      .eq('translator_id', profile.id)
      .eq('enabled', true)
      .order('sort_order', { ascending: true });
    paymentMethods = (data ?? []) as typeof paymentMethods;
  } catch {
    // миграция 037 не накачена
  }

  // accepts_coins_for_chapters хранится в profiles, доступен через public_profiles
  // только если мы его туда добавили. Здесь — прямо читаем у себя, если viewer==profile;
  // иначе берём из отдельного поля через отдельный select (он публичный вычисляемый
  // в viewer-safe колонках мы не объявляли, поэтому отдельный вызов через RPC
  // был бы аккуратнее; пока читаем честно — для этого поля нужен маленький RPC).
  let acceptsCoins = true;
  try {
    const { data } = await supabase
      .from('profiles')
      .select('accepts_coins_for_chapters')
      .eq('id', profile.id)
      .maybeSingle();
    const ac = (data as { accepts_coins_for_chapters?: boolean | null } | null)
      ?.accepts_coins_for_chapters;
    // Для чужих профилей RLS отдаст null — оставляем дефолт true.
    if (typeof ac === 'boolean') acceptsCoins = ac;
  } catch {
    /* ok */
  }

  // Существующая pending-заявка на монеты у этого переводчика
  let pendingCoinsClaim: {
    id: number;
    code: string;
    coins_amount: number;
    provider: string;
  } | null = null;
  if (viewer) {
    try {
      const { data } = await supabase
        .from('subscription_claims')
        .select('id, code, coins_amount, provider')
        .eq('user_id', viewer.id)
        .eq('translator_id', profile.id)
        .eq('kind', 'coins')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        pendingCoinsClaim = {
          id: data.id as number,
          code: data.code as string,
          coins_amount: (data.coins_amount as number | null) ?? 0,
          provider: (data.provider as string) ?? 'boosty',
        };
      }
    } catch {
      // миграция 045 не накачена — блок просто без pending
    }
  }

  // ---- Handshake: сколько новелл переводчика viewer уже читал ----
  let sharedReadsCount = 0;
  let topSharedTitles: string[] = [];
  if (viewer) {
    const { data: viewerProfile } = await supabase
      .from('profiles')
      .select('last_read, bookmarks')
      .eq('id', viewer.id)
      .maybeSingle();

    const lastRead = (viewerProfile as { last_read?: Record<string, unknown> } | null)?.last_read ?? {};
    const readIdSet = new Set(Object.keys(lastRead).map((s) => parseInt(s, 10)));

    // Также учитываем закладки (по firebase_id)
    const bm = (viewerProfile as { bookmarks?: unknown } | null)?.bookmarks;
    const bookmarkFbIds = new Set<string>(
      Array.isArray(bm)
        ? (bm as string[])
        : bm && typeof bm === 'object'
        ? Object.keys(bm as Record<string, unknown>)
        : []
    );

    const sharedNovels = novelsNormalized.filter(
      (n) => readIdSet.has(n.id) || bookmarkFbIds.has(n.firebase_id)
    );
    sharedReadsCount = sharedNovels.length;
    topSharedTitles = sharedNovels.slice(0, 3).map((n) => n.title);
  }

  const isSelf = viewer?.id === profile.id;

  // ---- Стена благодарностей: последние чаевые с message/tip ----
  let tributes: Tribute[] = [];
  try {
    const { data: rawTributes } = await supabase
      .from('translator_tributes_view')
      .select('*')
      .eq('translator_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(12);
    tributes = (rawTributes ?? []) as Tribute[];
  } catch {
    // миграция 031 ещё не накачена — пропускаем
  }

  // ---- Письма читателей (free thanks, мигр. 060) ----
  let thanks: ThanksWallRow[] = [];
  try {
    thanks = await fetchPublicThanksForTranslator(supabase, profile.id, 24);
  } catch {
    // миграция 060 ещё не накачена — тихо пропускаем
  }

  // ---- Публичный роадмап ----
  let roadmap: RoadmapItem[] = [];
  try {
    const { data: rawRoadmap } = await supabase
      .from('translator_roadmap')
      .select('id, title, note, status, progress_current, progress_total, sort_order')
      .eq('translator_id', profile.id)
      .order('sort_order', { ascending: true })
      .order('updated_at', { ascending: false });
    roadmap = (rawRoadmap ?? []) as RoadmapItem[];
  } catch {
    // миграция 031 ещё не накачена
  }

  // ---- Рейтинг + последние отзывы по маркетплейсу (миграция 033) ----
  let marketRating = { avg: 0, count: 0 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let marketReviews: any[] = [];
  try {
    const { data: ratingRow } = await supabase
      .from('marketplace_ratings')
      .select('avg_rating, reviews_count')
      .eq('user_id', profile.id)
      .maybeSingle();
    if (ratingRow) {
      marketRating = {
        avg: Number(ratingRow.avg_rating ?? 0),
        count: Number(ratingRow.reviews_count ?? 0),
      };
    }
    if (marketRating.count > 0) {
      const { data: reviewRows } = await supabase
        .from('marketplace_reviews_view')
        .select('*')
        .eq('subject_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(10);
      marketReviews = reviewRows ?? [];
    }
  } catch {
    // миграция 033 ещё не накачена
  }

  const totalChapters = novelsNormalized.reduce(
    (s, n) => s + (n.chapter_count ?? 0),
    0
  );
  const avatarInitial = displayName.trim().charAt(0).toUpperCase() || '?';

  return (
    <main className="container section">
      <div className="admin-breadcrumbs">
        <Link href="/">Главная</Link>
        <span>/</span>
        <span>Переводчик</span>
      </div>
      {/* Шапка переводчика */}
      <div className="translator-hero">
        <div className="translator-hero-avatar">
          {profile.translator_avatar_url ? (
            <img src={profile.translator_avatar_url} alt={displayName} />
          ) : (
            <span>{avatarInitial}</span>
          )}
        </div>
        <div className="translator-hero-body">
          <h1>{displayName}</h1>
          <div className="translator-hero-slug">@{effectiveSlug}</div>
          <ProfileRatingBadge avgRating={marketRating.avg} count={marketRating.count} />
          {profile.translator_about && (
            <p className="translator-hero-about">{profile.translator_about}</p>
          )}
          <div className="translator-hero-stats">
            <span>
              <strong>{novelsNormalized.length}</strong>{' '}
              {pluralRu(novelsNormalized.length, 'новелла', 'новеллы', 'новелл')}
            </span>
            <span>
              <strong>{totalChapters}</strong>{' '}
              {pluralRu(totalChapters, 'глава', 'главы', 'глав')}
            </span>
          </div>
        </div>

        {/* Киллер #3 блока поддержки: прямые CTA-ссылки + статус */}
        <aside className="translator-support">
          <div className="translator-support-head">Поддержать</div>
          {profile.payout_boosty_url ? (
            <a
              href={profile.payout_boosty_url}
              target="_blank"
              rel="noreferrer"
              className="btn btn-primary"
            >
              Подписка на Boosty
            </a>
          ) : (
            <button className="btn btn-ghost" disabled style={{ opacity: 0.5 }}>
              Boosty скоро
            </button>
          )}
          {profile.payout_tribute_channel && (
            <a
              href={`https://t.me/${profile.payout_tribute_channel.replace(/^@/, '')}`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost"
            >
              Tribute донат
            </a>
          )}
          <Link href="/profile" className="btn btn-ghost">
            Купить монеты
          </Link>
          <p className="translator-support-note">
            Подпиской ты открываешь все главы этого переводчика. Донаты и монеты — по желанию.
          </p>
        </aside>
      </div>

      {/* Тихий режим: если пауза активна — деликатный баннер */}
      {profile.quiet_until &&
        new Date(profile.quiet_until).getTime() > Date.now() && (
          <QuietBanner
            quietUntil={profile.quiet_until}
            quietNote={profile.quiet_note}
            translatorName={displayName}
          />
        )}

      {/* Кошелёк читателя у этого переводчика + кнопка «Пополнить» */}
      <TranslatorWallet
        translatorId={profile.id}
        translatorName={displayName}
        acceptsCoins={acceptsCoins}
        paymentMethods={paymentMethods}
        pendingClaim={pendingCoinsClaim}
        isLoggedIn={!!viewer}
        isSelf={isSelf}
      />

      {/* Роадмап: «что буду переводить» */}
      <RoadmapBoard items={roadmap} />

      {/* Письма читателей — бесплатные эмоциональные сообщения (мигр. 060) */}
      <ThanksWall thanks={thanks} />

      {/* Стена благодарностей — чаевые с сообщением (мигр. 031) */}
      <TributesWall tributes={tributes} />

      {/* Отзывы о работе из маркетплейса */}
      <ProfileReviewsList
        reviews={marketReviews}
        avgRating={marketRating.avg}
        count={marketRating.count}
      />

      {/* Киллер #1: рукопожатие */}
      <TranslatorHandshake
        sharedReadsCount={sharedReadsCount}
        totalNovels={novelsNormalized.length}
        topSharedTitles={topSharedTitles}
        selfSlug={isSelf ? effectiveSlug : null}
      />

      {/* Киллер #2: heatmap выпусков */}
      {releaseDays.length > 0 && <ReleaseHeatmap days={releaseDays} />}

      {/* Киллер #3 специализации: жанр-breakdown + топ хиты */}
      <TranslatorSpecialty novels={novelsNormalized} />

      {/* Публичное расписание выхода глав */}
      <TranslatorSchedule slots={scheduleSlots} todayDow={todayDow} />

      {/* Фильмография (IMDb-стиль): роли помимо «главного переводчика» */}
      <TranslatorFilmography entries={filmography} />

      {/* Все новеллы переводчика */}
      <section className="section">
        <div className="section-head">
          <h2>Все новеллы</h2>
          <span className="more" style={{ cursor: 'default' }}>
            {novelsNormalized.length}
          </span>
        </div>

        {novelsNormalized.length === 0 ? (
          <div className="empty-state">
            <p>У этого переводчика пока нет опубликованных новелл.</p>
          </div>
        ) : (
          <div className="novel-grid">
            {novelsNormalized.map((n, i) => (
              <NovelCard
                key={n.id}
                id={n.firebase_id}
                title={n.title}
                translator={displayName}
                translatorSlug={effectiveSlug}
                metaInfo={`${n.chapter_count ?? 0} гл.`}
                rating={n.average_rating ? Number(n.average_rating).toFixed(1) : '—'}
                coverUrl={getCoverUrl(n.cover_url)}
                placeholderClass={`p${(i % 8) + 1}`}
                placeholderText={n.title.substring(0, 12)}
                chapterCount={n.chapter_count}
                flagText={n.is_completed ? 'FIN' : undefined}
                flagClass={n.is_completed ? 'done' : undefined}
              />
            ))}
          </div>
        )}
      </section>
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
