import { createClient } from '@/utils/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import AdultGate from '@/components/AdultGate';
import BookmarkButton from '@/components/BookmarkButton';
import NovelClaimButton from '@/components/NovelClaimButton';
import ReportButton from '@/components/ReportButton';
import StarRating from '@/components/novel/StarRating';
import NovelTabs from '@/components/novel/NovelTabs';
import { getCoverUrl, cleanGenres } from '@/lib/format';
import { formatReadingTime } from '@/lib/catalog';
import { safeUrl } from '@/lib/sanitize';
import { findNovelByParam } from '@/lib/novel-lookup';

// NovelHero — общая шапка страницы новеллы (обложка + информация +
// действия + sticky-табы). Используется на всех трёх подстраницах:
//   /novel/[id]            — «О тайтле» (page.tsx)
//   /novel/[id]/chapters   — «Главы»
//   /novel/[id]/reviews    — «Отзывы»
// Каждая подстраница рендерит <NovelHero idOrFirebaseId={id} /> в начале
// своего <main>, потом — собственный контент.
//
// Параметр idOrFirebaseId принимает:
//   - firebase_id (каноничный chaptify-формат) — например, "harem-tomb-raider"
//   - numeric novels.id — формат tene-бота уведомлений ("27")
// Все внутренние ссылки строятся на novel.firebase_id (после lookup).
export default async function NovelHero({
  firebaseId,
}: {
  /** Может быть и числовой id, и firebase_id — поддержка обоих форматов
      нужна для совместимости со ссылками из бота уведомлений tene. */
  firebaseId: string;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: novel } = await findNovelByParam(supabase, firebaseId, '*');

  if (!novel) notFound();

  // Профиль текущего пользователя — определяет canEdit + bookmarkStatus.
  const { data: viewerProfile } = user
    ? await supabase
        .from('profiles')
        .select('role, is_admin, bookmarks')
        .eq('id', user.id)
        .maybeSingle()
    : { data: null };

  const vp = viewerProfile as {
    role?: string;
    is_admin?: boolean;
    bookmarks?: unknown;
  } | null;
  const viewerIsAdmin = vp?.is_admin === true || vp?.role === 'admin';
  const canEdit = !!user && (novel.translator_id === user.id || viewerIsAdmin);

  // Не опубликована и не своя/не админ — 404 (как и в старой логике).
  if (novel.moderation_status !== 'published' && !canEdit) {
    notFound();
  }

  // Моя оценка (для подсветки звёзд).
  let myRating: number | null = null;
  if (user) {
    try {
      const { data: rrow } = await supabase
        .from('novel_ratings')
        .select('rating')
        .eq('novel_id', novel.id)
        .eq('user_id', user.id)
        .maybeSingle();
      const r = (rrow as { rating?: number } | null)?.rating;
      myRating = typeof r === 'number' && r >= 1 && r <= 5 ? r : null;
    } catch {
      myRating = null;
    }
  }

  // Статус закладки (для BookmarkButton).
  let bookmarkStatus: string | null = null;
  if (vp?.bookmarks) {
    const bm = vp.bookmarks;
    if (Array.isArray(bm)) {
      if ((bm as string[]).includes(novel.firebase_id)) bookmarkStatus = 'reading';
    } else if (typeof bm === 'object') {
      const s = (bm as Record<string, unknown>)[novel.firebase_id];
      if (typeof s === 'string') bookmarkStatus = s;
    }
  }

  // Команда / переводчик — для красивых карточек ниже метрик.
  const novelTeamId = (novel as { team_id?: number | null }).team_id ?? null;
  let teamProfile: {
    id: number;
    slug: string;
    name: string;
    avatarUrl: string | null;
    bannerUrl: string | null;
    description: string | null;
    memberCount: number;
    novelCount: number;
    leaderName: string | null;
    memberAvatars: Array<{ url: string | null; initial: string }>;
  } | null = null;
  if (novelTeamId) {
    const [{ data: tv }, { data: tm }] = await Promise.all([
      supabase
        .from('team_view')
        .select(
          'id, slug, name, avatar_url, banner_url, description, member_count, novel_count, owner_display_name, owner_user_name'
        )
        .eq('id', novelTeamId)
        .maybeSingle(),
      supabase
        .from('team_members_view')
        .select('user_id, avatar_url, translator_display_name, user_name, sort_order, role')
        .eq('team_id', novelTeamId)
        .order('sort_order', { ascending: true })
        .limit(5),
    ]);
    if (tv) {
      const t = tv as {
        id: number;
        slug: string;
        name: string;
        avatar_url: string | null;
        banner_url: string | null;
        description: string | null;
        member_count: number | null;
        novel_count: number | null;
        owner_display_name: string | null;
        owner_user_name: string | null;
      };
      const members = (tm ?? []) as Array<{
        user_id: string;
        avatar_url: string | null;
        translator_display_name: string | null;
        user_name: string | null;
      }>;
      teamProfile = {
        id: t.id,
        slug: t.slug,
        name: t.name,
        avatarUrl: t.avatar_url,
        bannerUrl: t.banner_url,
        description: t.description,
        memberCount: t.member_count ?? members.length,
        novelCount: t.novel_count ?? 0,
        leaderName: t.owner_display_name || t.owner_user_name || null,
        memberAvatars: members.map((m) => ({
          url: m.avatar_url,
          initial:
            (m.translator_display_name || m.user_name || '?').slice(0, 1).toUpperCase(),
        })),
      };
    }
  }

  let translatorProfile: {
    slug: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  } | null = null;
  if (novel.translator_id) {
    const { data: tp } = await supabase
      .from('profiles')
      .select('translator_slug, translator_display_name, translator_avatar_url, user_name')
      .eq('id', novel.translator_id)
      .maybeSingle();
    const p = tp as {
      translator_slug?: string | null;
      translator_display_name?: string | null;
      translator_avatar_url?: string | null;
      user_name?: string | null;
    } | null;
    if (p) {
      translatorProfile = {
        slug: p.translator_slug || p.user_name || null,
        displayName: p.translator_display_name || p.user_name || null,
        avatarUrl: p.translator_avatar_url || null,
      };
    }
  }
  if (!translatorProfile && novel.author) {
    const { data: tp } = await supabase
      .from('profiles')
      .select('translator_slug, translator_display_name, translator_avatar_url, user_name')
      .ilike('user_name', novel.author)
      .maybeSingle();
    const p = tp as {
      translator_slug?: string | null;
      translator_display_name?: string | null;
      translator_avatar_url?: string | null;
      user_name?: string | null;
    } | null;
    if (p) {
      translatorProfile = {
        slug: p.translator_slug || p.user_name || null,
        displayName: p.translator_display_name || p.user_name || null,
        avatarUrl: p.translator_avatar_url || null,
      };
    }
  }
  const translatorSlug = translatorProfile?.slug ?? null;
  const translatorInitial =
    (translatorProfile?.displayName || 'П').trim().charAt(0).toUpperCase();

  // Кнопка «Продолжить с N главы» / «Читать с 1-й». Берём минимум —
  // только chapter_number, чтобы построить ссылку.
  const nowIso = new Date().toISOString();
  const { data: firstChapterRow } = await supabase
    .from('chapters')
    .select('chapter_number')
    .eq('novel_id', novel.id)
    .not('published_at', 'is', null)
    .lte('published_at', nowIso)
    .order('chapter_number', { ascending: true })
    .limit(1)
    .maybeSingle();
  const firstChapter = firstChapterRow ?? null;
  const firstChapterNumber = firstChapter?.chapter_number ?? 1;

  // Текущая глава пользователя — из last_read.
  let myCurrentChapter: number | null = null;
  if (user) {
    try {
      const { data: lrRow } = await supabase
        .from('profiles')
        .select('last_read')
        .eq('id', user.id)
        .maybeSingle();
      const lrObj =
        (lrRow as { last_read?: Record<string, { chapterId?: number; timestamp?: string }> } | null)
          ?.last_read ?? {};
      const entry = lrObj[String(novel.id)];
      if (typeof entry?.chapterId === 'number' && entry.chapterId > 0) {
        myCurrentChapter = entry.chapterId;
      }
    } catch {
      myCurrentChapter = null;
    }
  }

  // Автор / жанры
  const authorVariants = [
    novel.author_original as string | undefined,
    novel.author_en as string | undefined,
    novel.author as string | undefined,
  ].filter((s): s is string => !!s && s.trim().length > 0);
  const authorDisplay = authorVariants.length > 0 ? authorVariants.join(' / ') : null;
  const coverUrl = getCoverUrl(novel.cover_url);
  const genres = cleanGenres(novel.genres);
  const primaryGenre = genres[0];

  return (
    <>
      {novel.age_rating === '18+' && (
        <AdultGate novelTitle={novel.title} scope={novel.firebase_id} />
      )}
      <section className="container">
        <div className="novel-top">
          <div className="cover-large">
            <div
              className="novel-cover"
              style={{ aspectRatio: '3/4', borderRadius: 'var(--radius)' }}
            >
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt={novel.title}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <div className="placeholder p1" style={{ fontSize: 22 }}>
                  {novel.title}
                </div>
              )}
              <span className="rating-chip">
                <span className="star">★</span>
                {novel.average_rating > 0 ? Number(novel.average_rating).toFixed(1) : '—'}
              </span>
            </div>

            {/* Звёздная оценка — компактно, центрированно, прямо под обложкой. */}
            <StarRating
              novelId={novel.id}
              initialMyRating={myRating}
              averageRating={novel.average_rating ?? null}
              ratingCount={novel.rating_count ?? null}
              isLoggedIn={!!user}
            />
          </div>

          <div className="novel-info">
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              {primaryGenre && <span className="note">{primaryGenre}</span>}
              <span
                className="note"
                style={
                  novel.is_completed
                    ? { background: '#E6DCC8', color: 'var(--ink-soft)' }
                    : { background: '#E3EBD6', color: '#4C6A34' }
                }
              >
                {novel.is_completed ? 'Завершена' : 'Обновляется'}
              </span>
              {novel.chapter_count > 0 && (
                <span className="note" style={{ background: 'var(--bg-soft)', color: 'var(--ink-soft)' }}>
                  {formatReadingTime(novel.chapter_count)}
                </span>
              )}
            </div>

            <h1>{novel.title}</h1>
            {authorDisplay && (
              <div className="subtitle">
                Автор: {authorDisplay}
              </div>
            )}

            <div className="info-row">
              <div className="metric">
                <div className="val">
                  <span className="star">★</span>{' '}
                  {novel.average_rating > 0 ? Number(novel.average_rating).toFixed(1) : '—'}
                </div>
                <div className="label">
                  {novel.rating_count || 0}{' '}
                  {novel.rating_count === 1 ? 'оценка' : 'оценок'}
                </div>
              </div>
              <div className="metric">
                <div className="val">{novel.chapter_count ?? 0}</div>
                <div className="label">глав</div>
              </div>
              <div className="metric">
                <div className="val">{formatViews(novel.views)}</div>
                <div className="label">прочтений</div>
              </div>
            </div>

            {genres.length > 0 && (
              <div className="tags">
                {genres.map((g) => (
                  <Link
                    key={g}
                    href={`/catalog?genre=${encodeURIComponent(g)}`}
                    className="tag tag--link"
                  >
                    {g}
                  </Link>
                ))}
              </div>
            )}

            {teamProfile && (() => {
              const showLeader =
                teamProfile.leaderName &&
                teamProfile.leaderName.trim().toLowerCase() !==
                  teamProfile.name.trim().toLowerCase();
              const showStack = teamProfile.memberCount > 1 &&
                teamProfile.memberAvatars.length > 0;
              return (
                <Link
                  href={`/team/${teamProfile.slug}`}
                  className={`novel-team-card${
                    teamProfile.bannerUrl ? ' has-banner' : ''
                  }`}
                  aria-label={`Перевод команды ${teamProfile.name}`}
                  style={
                    teamProfile.bannerUrl
                      ? ({ ['--ntc-banner' as string]: `url(${teamProfile.bannerUrl})` } as React.CSSProperties)
                      : undefined
                  }
                >
                  <span className="novel-team-card-deco" aria-hidden="true">🪶</span>

                  <div className="novel-team-card-avatar" aria-hidden="true">
                    {teamProfile.avatarUrl ? (
                      <img src={teamProfile.avatarUrl} alt="" />
                    ) : (
                      <span>{teamProfile.name.slice(0, 1).toUpperCase()}</span>
                    )}
                  </div>

                  <div className="novel-team-card-text">
                    <div className="novel-team-card-eyebrow">
                      <span className="novel-team-card-eyebrow-icon" aria-hidden="true">🪶</span>
                      Перевод команды
                    </div>
                    <div className="novel-team-card-name">{teamProfile.name}</div>
                    {teamProfile.description && (
                      <div className="novel-team-card-desc">
                        {teamProfile.description}
                      </div>
                    )}
                    <div className="novel-team-card-meta">
                      <strong>{teamProfile.memberCount}</strong>{' '}
                      {pluralMembers(teamProfile.memberCount)}
                      <span className="novel-team-card-meta-sep" aria-hidden="true">·</span>
                      <strong>{teamProfile.novelCount}</strong>{' '}
                      {pluralNovels(teamProfile.novelCount)}
                      {showLeader && (
                        <>
                          <span className="novel-team-card-meta-sep" aria-hidden="true">·</span>
                          лидер{' '}
                          <strong className="novel-team-card-leader-inline">
                            {teamProfile.leaderName}
                          </strong>
                        </>
                      )}
                    </div>
                  </div>

                  {showStack && (
                    <div
                      className="novel-team-card-stack"
                      aria-hidden="true"
                      title={`${teamProfile.memberCount} ${pluralMembers(
                        teamProfile.memberCount
                      )} в команде`}
                    >
                      {teamProfile.memberAvatars.map((a, i) => (
                        <span
                          key={i}
                          className={`novel-team-card-stack-item${
                            !a.url ? ' is-fallback' : ''
                          }`}
                          style={{ zIndex: 5 - i }}
                        >
                          {a.url ? <img src={a.url} alt="" /> : <span>{a.initial}</span>}
                        </span>
                      ))}
                      {teamProfile.memberCount > teamProfile.memberAvatars.length && (
                        <span
                          className="novel-team-card-stack-item novel-team-card-stack-more"
                          style={{ zIndex: 0 }}
                        >
                          +{teamProfile.memberCount - teamProfile.memberAvatars.length}
                        </span>
                      )}
                    </div>
                  )}

                  <span className="novel-team-card-cta">
                    Зайти в команду
                    <span className="novel-team-card-cta-arrow" aria-hidden="true">→</span>
                  </span>
                </Link>
              );
            })()}

            {!teamProfile && translatorProfile && (
              <div className="translator-card">
                <Link
                  href={translatorSlug ? `/t/${translatorSlug}` : '#'}
                  className="translator-card-link"
                  aria-label={`Профиль ${translatorProfile.displayName ?? 'переводчика'}`}
                >
                  <div className="avatar">
                    {translatorProfile.avatarUrl ? (
                      <img src={translatorProfile.avatarUrl} alt="" />
                    ) : (
                      <span>{translatorInitial}</span>
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="name">
                      {translatorProfile.displayName ?? 'Переводчик'}
                    </div>
                    <div className="role">Переводчик</div>
                  </div>
                </Link>
                <div className="translator-card-actions">
                  {translatorSlug && (
                    <Link href={`/t/${translatorSlug}`} className="btn btn-ghost">
                      Профиль →
                    </Link>
                  )}
                  {user && novel.translator_id && user.id !== novel.translator_id && (
                    <Link
                      href={`/messages/${novel.translator_id}`}
                      className="btn btn-primary"
                      title="Написать переводчику в личку"
                    >
                      💬 В ЛС
                    </Link>
                  )}
                </div>
              </div>
            )}

            {!translatorProfile && novel.external_translator_name && (
              <div className="translator-card translator-card--external">
                <div
                  className="avatar"
                  style={{
                    background:
                      'linear-gradient(135deg, var(--ink-mute), var(--ink-soft))',
                  }}
                  aria-hidden="true"
                >
                  <span>
                    {novel.external_translator_name.trim().charAt(0).toUpperCase()}
                  </span>
                </div>
                <div style={{ flex: 1 }}>
                  <div className="name">{novel.external_translator_name}</div>
                  <div className="role">
                    Внешний переводчик · не зарегистрирован у нас
                  </div>
                </div>
                {safeUrl(novel.external_translator_url) ? (
                  <a
                    href={safeUrl(novel.external_translator_url)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-ghost"
                  >
                    Профиль ↗
                  </a>
                ) : null}
                {user && (viewerIsAdmin || vp?.role === 'translator') && (
                  <NovelClaimButton
                    novelId={novel.id}
                    novelTitle={novel.title}
                    externalName={novel.external_translator_name}
                  />
                )}
              </div>
            )}

            <div className="actions-row">
              {myCurrentChapter ? (
                <Link
                  href={`/novel/${novel.firebase_id}/${myCurrentChapter}`}
                  className="btn btn-primary"
                >
                  Продолжить с {myCurrentChapter}-й главы
                </Link>
              ) : firstChapter ? (
                <Link
                  href={`/novel/${novel.firebase_id}/${firstChapterNumber}`}
                  className="btn btn-primary"
                >
                  Читать с 1-й главы
                </Link>
              ) : (
                <span
                  className="btn btn-ghost"
                  aria-disabled="true"
                  title="Переводчик ещё не выложил ни одной главы. Загляни попозже."
                  style={{ cursor: 'not-allowed', opacity: 0.7 }}
                >
                  Главы ещё не вышли
                </span>
              )}
              {user && (
                <BookmarkButton
                  novelFirebaseId={novel.firebase_id}
                  initialStatus={bookmarkStatus}
                />
              )}
              <a
                href={`/api/novel/${novel.firebase_id}/epub`}
                className="btn btn-ghost"
                title="Скачать для чтения офлайн. Подписчики получают все главы, остальные — те, что им доступны."
              >
                📘 EPUB
              </a>
              {!canEdit && (
                <ReportButton
                  targetType="novel"
                  targetId={novel.id}
                  isLoggedIn={!!user}
                />
              )}
              {canEdit && (
                <>
                  <Link
                    href={`/admin/novels/${novel.firebase_id}/chapters/new`}
                    className="btn btn-ghost"
                    style={{ borderColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    + Добавить главу
                  </Link>
                  <Link
                    href={`/admin/novels/${novel.firebase_id}/edit`}
                    className="btn btn-ghost"
                  >
                    Редактировать
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Sticky-табы. Каждый — отдельный роут /novel/<firebase_id>/{segment}.
            Используем canonical firebase_id, а не входной idOrFirebaseId, —
            чтобы переходы между табами всегда шли на «красивый» URL. */}
        <NovelTabs
          novelFirebaseId={novel.firebase_id}
          tabs={[
            { segment: '',         label: 'О тайтле' },
            { segment: 'chapters', label: 'Главы' },
            { segment: 'reviews',  label: 'Отзывы' },
          ]}
        />
      </section>
    </>
  );
}

function formatViews(n: number | null | undefined) {
  if (!n) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`.replace('.0', '');
  return n.toLocaleString('ru-RU');
}

function pluralMembers(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'участник';
  if ([2, 3, 4].includes(m10) && ![12, 13, 14].includes(m100)) return 'участника';
  return 'участников';
}

function pluralNovels(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'новелла';
  if ([2, 3, 4].includes(m10) && ![12, 13, 14].includes(m100)) return 'новеллы';
  return 'новелл';
}
