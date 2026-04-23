import { createClient } from '@/utils/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import NovelCard from '@/components/NovelCard';
import FirstChapterPreview from '@/components/FirstChapterPreview';
import SimilarByReaders from '@/components/SimilarByReaders';
import ReleasePace from '@/components/ReleasePace';
import BookmarkButton from '@/components/BookmarkButton';
import NovelClaimButton from '@/components/NovelClaimButton';
import AdultGate from '@/components/AdultGate';
import NovelCredits, { type CreditRow } from '@/components/novel/NovelCredits';
import { getCoverUrl } from '@/lib/format';
import { formatReadingTime } from '@/lib/catalog';
import { fetchTranslatorSlugs } from '@/lib/translator';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}

const CHAPTERS_PER_PAGE = 50;

function formatChapterDate(published: string | null) {
  if (!published) return '';
  const date = new Date(published);
  const diffDays = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (diffDays <= 0) return `сегодня, ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  if (diffDays === 1) return `вчера, ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  if (diffDays < 7) return `${diffDays} дн. назад`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} нед. назад`;
  return date.toLocaleDateString('ru-RU');
}

function formatCount(n: number | null | undefined) {
  if (!n) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`.replace('.0', '');
  return n.toLocaleString('ru-RU');
}

// Текст первого абзаца без html, подрезанный до ~280 символов.
function extractFirstParagraph(html: string, limit = 280): string {
  const text = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= limit) return text;
  const slice = text.slice(0, limit);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > limit / 2 ? slice.slice(0, lastSpace) : slice) + '…';
}

export default async function NovelPage({ params, searchParams }: PageProps) {
  const supabase = await createClient();
  const { id } = await params;
  const { page: pageRaw } = await searchParams;
  const page = Math.max(1, parseInt(pageRaw ?? '1', 10) || 1);

  const { data: { user } } = await supabase.auth.getUser();

  const { data: novel, error: novelError } = await supabase
    .from('novels_view')
    .select('*')
    .eq('firebase_id', id)
    .single();

  if (novelError || !novel) notFound();

  const { data: viewerProfile } = user
    ? await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
    : { data: null };

  const vp = viewerProfile as {
    role?: string;
    is_admin?: boolean;
    bookmarks?: unknown;
  } | null;
  const viewerIsAdmin = vp?.is_admin === true || vp?.role === 'admin';

  // Текущий статус в закладках для переключателя
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

  const canEdit = !!user && (novel.translator_id === user.id || viewerIsAdmin);

  // Скрываем неопубликованные новеллы от посторонних. Переводчик и админ
  // видят draft/pending/rejected, чтобы подготовить карточку и нажать «на модерацию».
  if (novel.moderation_status !== 'published' && !canEdit) {
    notFound();
  }

  // Профиль переводчика для блока «Переводчик»
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
  // Fallback (legacy): если translator_id не задан — ищем по совпадению user_name с novel.author
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

  // Команда новеллы — novel_translators + имена/аватарки. Если миграция 034
  // ещё не накачена, view отсутствует — пропускаем.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let novelCredits: any[] = [];
  try {
    const { data: cred } = await supabase
      .from('novel_credits')
      .select('*')
      .eq('novel_id', novel.id)
      .order('sort_order', { ascending: true });
    novelCredits = cred ?? [];
  } catch {
    novelCredits = [];
  }

  // Пагинация: от пагинации зависят и выборка, и счётчик.
  // Переводчик / админ видит все главы (в т.ч. черновики и запланированные).
  // Читатель видит только опубликованные (published_at <= now()).
  const nowIso = new Date().toISOString();
  const from = (page - 1) * CHAPTERS_PER_PAGE;
  const to = from + CHAPTERS_PER_PAGE - 1;

  const chaptersQuery = supabase
    .from('chapters')
    .select(
      'id, chapter_number, is_paid, price_coins, published_at, content_path',
      { count: 'exact' }
    )
    .eq('novel_id', novel.id)
    .order('chapter_number', { ascending: false })
    .range(from, to);

  if (!canEdit) {
    chaptersQuery
      .not('published_at', 'is', null)
      .lte('published_at', nowIso);
  }

  // Для firstChapter (кнопка «Читать первую») нужна самая ранняя
  // опубликованная глава, независимо от страницы. Берём лёгкий отдельный
  // запрос — только один ряд.
  const firstChapterQuery = supabase
    .from('chapters')
    .select('chapter_number, content_path')
    .eq('novel_id', novel.id)
    .not('published_at', 'is', null)
    .lte('published_at', nowIso)
    .order('chapter_number', { ascending: true })
    .limit(1)
    .maybeSingle();

  const [
    { data: chaptersDesc, count: chaptersCount },
    { data: firstChapterRow },
    { data: similarByReaders },
    { data: paceRaw },
  ] = await Promise.all([
    chaptersQuery,
    firstChapterQuery,
    supabase.rpc('get_similar_novels_by_readers', { p_novel_id: novel.id, p_limit: 6 }),
    supabase.rpc('get_release_pace', { p_novel_id: novel.id, p_days: 90 }),
  ]);

  const chapters = chaptersDesc ?? [];
  const totalChapters = chaptersCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalChapters / CHAPTERS_PER_PAGE));
  const firstChapter = firstChapterRow ?? null;

  // Какие главы уже куплены текущим читателем — для подсветки в списке.
  // RPC из миграции 018; если её ещё нет, тихо падаем и не подсвечиваем.
  let purchasedChapters: Set<number> = new Set();
  if (user) {
    try {
      const { data: purchased } = await supabase.rpc('my_purchased_chapters', {
        p_novel: novel.id,
      });
      if (Array.isArray(purchased)) {
        purchasedChapters = new Set(purchased as number[]);
      }
    } catch {
      // миграция 018 не накачена
    }
  }

  // Есть ли активная подписка (любая — Boosty claim, tribute, etc.)?
  // Если есть — все платные главы показываем как открытые.
  let hasActiveSubscription = false;
  if (user && novel.translator_id) {
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('id, expires_at')
      .eq('user_id', user.id)
      .eq('translator_id', novel.translator_id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    if (sub) {
      const exp = (sub as { expires_at?: string | null }).expires_at;
      hasActiveSubscription = !exp || new Date(exp).getTime() > Date.now();
    }
  }

  // Член команды новеллы (основной переводчик, редактор, корректор…) читает
  // всё платное бесплатно — can_read_chapter их пропускает (миграция 034).
  // Здесь этот флаг нужен только для UI: не рисовать «Купить».
  const isTeam = canEdit; // canEdit уже = translator_id===user.id || admin
  let isExtendedTeam = isTeam;
  if (user && !isTeam) {
    try {
      const { data: memberRow } = await supabase
        .from('novel_translators')
        .select('id')
        .eq('novel_id', novel.id)
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();
      if (memberRow) isExtendedTeam = true;
    } catch {
      /* миграция 034 не накачена */
    }
  }

  // Fallback для новелл без коллаборативки: ранжируем кандидатов по score.
  // Раньше брали только новеллы того же автора — мимо если переводчик
  // одиночка; теперь собираем пул по жанрам / переводчику / стране
  // и сортируем.
  //   +3  тот же переводчик (сильнее всего — читатели часто смотрят
  //       что ещё переводит тот же человек)
  //   +1  за каждый общий жанр
  //   +0.5 тот же author (редкий случай: один автор — разные переводы)
  //   +0.5 та же страна
  //   -1  если age_rating 18+ у кандидата, а у текущей не 18+ (не суём
  //       18+ новеллу читателю детской новеллы)
  let fallbackSimilar: unknown[] = [];
  if (!similarByReaders || similarByReaders.length === 0) {
    const currentGenres: string[] = Array.isArray(novel.genres) ? novel.genres : [];

    // Собираем пул-кандидатов: объединение разных критериев через отдельные
    // лёгкие запросы + дедупликация. Пулу хватает ~60 штук, чтобы потом
    // отсортировать в JS.
    const candidateMap = new Map<number, Record<string, unknown>>();
    const addAll = (rows: Record<string, unknown>[] | null | undefined) => {
      for (const r of rows ?? []) {
        const id = Number(r.id);
        if (!candidateMap.has(id)) candidateMap.set(id, r);
      }
    };

    const selectCols = '*';

    const byTranslator = novel.translator_id
      ? supabase.from('novels_view').select(selectCols)
          .eq('translator_id', novel.translator_id)
          .eq('moderation_status', 'published')
          .neq('firebase_id', novel.firebase_id)
          .limit(20)
      : Promise.resolve({ data: [] });

    const byAuthor = novel.author
      ? supabase.from('novels_view').select(selectCols)
          .eq('author', novel.author)
          .eq('moderation_status', 'published')
          .neq('firebase_id', novel.firebase_id)
          .limit(20)
      : Promise.resolve({ data: [] });

    const byGenre = currentGenres.length > 0
      ? supabase.from('novels_view').select(selectCols)
          .overlaps('genres', currentGenres)
          .eq('moderation_status', 'published')
          .neq('firebase_id', novel.firebase_id)
          .limit(40)
      : Promise.resolve({ data: [] });

    const [r1, r2, r3] = await Promise.all([byTranslator, byAuthor, byGenre]);
    addAll((r1 as { data: Record<string, unknown>[] | null }).data);
    addAll((r2 as { data: Record<string, unknown>[] | null }).data);
    addAll((r3 as { data: Record<string, unknown>[] | null }).data);

    const scored = Array.from(candidateMap.values()).map((c) => {
      const cGenres: string[] = Array.isArray(c.genres) ? (c.genres as string[]) : [];
      const commonGenres = cGenres.filter((g) => currentGenres.includes(g));
      let score = 0;
      if (c.translator_id && c.translator_id === novel.translator_id) score += 3;
      if (c.author && c.author === novel.author) score += 0.5;
      if (c.country && c.country === novel.country) score += 0.5;
      score += commonGenres.length;
      if (c.age_rating === '18+' && novel.age_rating !== '18+') score -= 1;
      const rating = Number(c.average_rating ?? 0);
      // Тайбрейкер: при равном score — более высокий рейтинг
      const tiebreak = rating * 0.01;
      return { ...c, score, _tiebreak: tiebreak };
    });

    fallbackSimilar = scored
      .filter((x) => x.score > 0)
      .sort((a, b) =>
        b.score - a.score !== 0 ? b.score - a.score : b._tiebreak - a._tiebreak
      )
      .slice(0, 6);
  }

  // Подтягиваем превью первого абзаца
  let previewText = '';
  let previewMinutes = 0;
  if (firstChapter?.content_path) {
    try {
      const { data: fileData } = await supabase.storage
        .from('chapter_content')
        .download(firstChapter.content_path);
      if (fileData) {
        const rawHtml = await fileData.text();
        previewText = extractFirstParagraph(rawHtml, 320);
        // ~1500 символов на минуту чтения
        const charCount = rawHtml.replace(/<[^>]+>/g, '').length;
        previewMinutes = Math.max(1, Math.round(charCount / 1500));
      }
    } catch {
      // молча — превью необязательно
    }
  }

  const coverUrl = getCoverUrl(novel.cover_url);
  const genres: string[] = Array.isArray(novel.genres) ? novel.genres : [];
  const primaryGenre = genres[0];
  const firstChapterNumber = firstChapter?.chapter_number ?? 1;

  // Автор в трёх вариантах: оригинал / английский / русский.
  // Формат вывода: «оригинал / английский / русский»
  // Показываем только заполненные, разделяем через « / »
  const authorVariants = [
    novel.author_original as string | undefined,
    novel.author_en as string | undefined,
    novel.author as string | undefined,
  ].filter((s): s is string => !!s && s.trim().length > 0);
  const authorDisplay = authorVariants.length > 0 ? authorVariants.join(' / ') : null;

  const translatorInitial =
    (translatorProfile?.displayName || 'П').trim().charAt(0).toUpperCase();

  // Slugs для блоков «Похожее» (коллаборативка + fallback)
  const similarSlugMap = await fetchTranslatorSlugs(
    supabase,
    [
      ...((similarByReaders ?? []) as Array<{ translator_id?: string | null }>).map(
        (n) => n.translator_id
      ),
      ...(fallbackSimilar as Array<{ translator_id?: string | null }>).map(
        (n) => n.translator_id
      ),
    ]
  );
  const fallbackSimilarSlugMap = similarSlugMap;

  return (
    <main>
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
                <div className="val">{totalChapters}</div>
                <div className="label">глав</div>
              </div>
              <div className="metric">
                <div className="val">{formatCount(novel.views)}</div>
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

            {translatorProfile && (
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
                {novel.external_translator_url ? (
                  <a
                    href={novel.external_translator_url}
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
              <Link
                href={`/novel/${novel.firebase_id}/${firstChapterNumber}`}
                className="btn btn-primary"
              >
                Читать с 1-й главы
              </Link>
              {user && (
                <BookmarkButton
                  novelFirebaseId={novel.firebase_id}
                  initialStatus={bookmarkStatus}
                />
              )}
              {/* EPUB: если переводчик загрузил готовый файл в epub_path —
                 отдадим его, иначе сервер соберёт на лету по уровню
                 доступа читателя (бесплатные / купленные / подписка). */}
              <a
                href={`/api/novel/${novel.firebase_id}/epub`}
                className="btn btn-ghost"
                title="Скачать для чтения офлайн. Подписчики получают все главы, остальные — те, что им доступны."
              >
                📘 EPUB
              </a>
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

        {novel.description && (
          <div className="desc">
            <strong>Описание.</strong>{' '}
            <span dangerouslySetInnerHTML={{ __html: novel.description }} />
          </div>
        )}

        {/* Киллер-фича #1 — предпросмотр первой главы */}
        {previewText && (
          <FirstChapterPreview
            novelFirebaseId={novel.firebase_id}
            firstChapterNumber={firstChapterNumber}
            previewText={previewText}
            readingMinutes={previewMinutes}
          />
        )}

        {/* Киллер-фича #3 — темп перевода */}
        {paceRaw && paceRaw.length > 0 && (
          <ReleasePace
            days={paceRaw.map((d: { day: string; chapters: number }) => ({
              day: d.day,
              chapters: d.chapters,
            }))}
            totalChapters={totalChapters}
            isCompleted={!!novel.is_completed}
          />
        )}

        {Array.isArray(novel.external_links) && novel.external_links.length > 0 && (
          <section className="external-links-block">
            <h3 className="external-links-title">Оригинал</h3>
            <div className="external-links-list">
              {(novel.external_links as Array<{ label: string; url: string }>).map(
                (link, i) =>
                  link.url ? (
                    <a
                      key={i}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="external-link"
                    >
                      <span>{link.label || hostnameOf(link.url)}</span>
                      <span className="external-link-arrow" aria-hidden="true">↗</span>
                    </a>
                  ) : null
              )}
            </div>
          </section>
        )}

        <NovelCredits credits={novelCredits as CreditRow[]} />

        <div className="chapter-list">
          <div className="chapter-list-head">
            <h3>Главы ({totalChapters})</h3>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
                Новые сверху
              </span>
            </div>
          </div>

          {totalChapters === 0 && (
            <div style={{ padding: 20, color: 'var(--ink-mute)' }}>Глав пока нет.</div>
          )}

          {chapters.map((chapter) => {
            const displayTitle = `Глава ${chapter.chapter_number}`;
            const isOwned = purchasedChapters.has(chapter.chapter_number);
            const price = chapter.price_coins ?? 10;
            const publishedMs = chapter.published_at
              ? new Date(chapter.published_at).getTime()
              : null;
            const isDraft = publishedMs === null;
            const isScheduled = publishedMs !== null && publishedMs > Date.now();
            // Доступ к главе уже есть: платная + куплена, бесплатная, член
            // команды (переводчик/редактор/…) или активная подписка.
            const hasAccess =
              !chapter.is_paid || isOwned || isExtendedTeam || hasActiveSubscription;
            return (
              <div
                key={chapter.id}
                className={`chapter-item${hasAccess && chapter.is_paid ? ' chapter-item--owned' : ''}${
                  isDraft ? ' chapter-item--draft' : ''
                }${isScheduled ? ' chapter-item--scheduled' : ''}`}
                style={{ position: 'relative' }}
              >
                {/* Overlay-link поверх всей карточки, чтобы клик по любой
                    части (название, дата, ценник) открывал главу. Кнопки
                    внизу имеют z-index выше — ловят клики раньше. */}
                <Link
                  href={`/novel/${novel.firebase_id}/${chapter.chapter_number}`}
                  className="chapter-item-overlay"
                  aria-label={`Открыть главу ${chapter.chapter_number}`}
                />
                <div>
                  <div className="title">
                    {displayTitle}
                    {isOwned && (
                      <span className="chapter-owned-badge" title="Эта глава куплена">
                        ✓ куплено
                      </span>
                    )}
                    {isDraft && (
                      <span className="chapter-status-badge chapter-status-badge--draft">
                        📝 черновик
                      </span>
                    )}
                    {isScheduled && (
                      <span className="chapter-status-badge chapter-status-badge--scheduled">
                        ⏰ выйдет {formatScheduled(chapter.published_at)}
                      </span>
                    )}
                  </div>
                  <div className="date">
                    {isDraft
                      ? 'не опубликована'
                      : isScheduled
                      ? 'запланирована'
                      : formatChapterDate(chapter.published_at)}
                  </div>
                </div>
                <span
                  className={`tag-price ${
                    chapter.is_paid ? (hasAccess ? 'owned' : 'paid') : 'free'
                  }`}
                >
                  {chapter.is_paid
                    ? hasAccess
                      ? isExtendedTeam
                        ? '✓ команда'
                        : hasActiveSubscription
                          ? '✓ подписка'
                          : `✓ ${price} монет`
                      : `${price} ${pluralCoins(price)}`
                    : 'Бесплатно'}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {canEdit && (
                    <Link
                      href={`/admin/novels/${novel.firebase_id}/chapters/${chapter.chapter_number}/edit`}
                      className="btn btn-ghost"
                      style={{ height: 32, padding: '0 10px', fontSize: 12 }}
                    >
                      Править
                    </Link>
                  )}
                  <Link
                    href={`/novel/${novel.firebase_id}/${chapter.chapter_number}`}
                    className={hasAccess ? 'btn btn-primary' : 'btn btn-ghost'}
                    style={{ height: 32, padding: '0 14px', fontSize: 13 }}
                  >
                    {isDraft || isScheduled
                      ? 'Предпросмотр'
                      : hasAccess
                      ? 'Читать'
                      : 'Открыть'}
                  </Link>
                </div>
              </div>
            );
          })}

          {totalPages > 1 && (
            <nav className="chapter-pagination" aria-label="Страницы глав">
              {page > 1 ? (
                <Link
                  href={`/novel/${novel.firebase_id}${page === 2 ? '' : `?page=${page - 1}`}`}
                  className="btn btn-ghost"
                >
                  ← Новее
                </Link>
              ) : (
                <span className="btn btn-ghost is-disabled" aria-disabled="true">
                  ← Новее
                </span>
              )}
              <span className="chapter-pagination-info">
                Страница {page} из {totalPages}
              </span>
              {page < totalPages ? (
                <Link
                  href={`/novel/${novel.firebase_id}?page=${page + 1}`}
                  className="btn btn-ghost"
                >
                  Старее →
                </Link>
              ) : (
                <span className="btn btn-ghost is-disabled" aria-disabled="true">
                  Старее →
                </span>
              )}
            </nav>
          )}
        </div>

        {/* Киллер-фича #2 — созвучие читателей */}
        {similarByReaders && similarByReaders.length > 0 && (
          <SimilarByReaders novels={similarByReaders} translatorSlugs={similarSlugMap} />
        )}

        {/* Фолбэк: «От этого же автора», если коллаборативка пустая */}
        {(!similarByReaders || similarByReaders.length === 0) && fallbackSimilar.length > 0 && (
          <>
            <div className="section-head">
              <h2>Похожее от {novel.author}</h2>
            </div>
            <div className="novel-grid">
              {(fallbackSimilar as Array<{
                id: number;
                firebase_id: string;
                title: string;
                author: string | null;
                cover_url: string | null;
                average_rating: number | null;
                rating_count: number | null;
                chapter_count: number | null;
                translator_id?: string | null;
              }>).map((n, index) => (
                <NovelCard
                  key={n.id}
                  id={n.firebase_id}
                  title={n.title}
                  translator={n.author || 'Автор'}
                  translatorSlug={
                    n.translator_id
                      ? fallbackSimilarSlugMap.get(n.translator_id) ?? null
                      : null
                  }
                  metaInfo={`${n.rating_count || 0} оценок`}
                  rating={n.average_rating ? Number(n.average_rating).toFixed(1) : '—'}
                  coverUrl={getCoverUrl(n.cover_url)}
                  placeholderClass={`p${(index % 8) + 1}`}
                  placeholderText={n.title.substring(0, 16)}
                  chapterCount={n.chapter_count}
                />
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function formatScheduled(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 60) return `через ${diffMin} мин`;
  const diffHr = Math.round(diffMin / 60);
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `сегодня в ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (
    d.getFullYear() === tomorrow.getFullYear() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getDate() === tomorrow.getDate()
  ) {
    return `завтра в ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (diffHr < 24 * 7) {
    return d.toLocaleString('ru-RU', {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return d.toLocaleDateString('ru-RU');
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function pluralCoins(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return 'монет';
  if (mod10 === 1) return 'монета';
  if (mod10 >= 2 && mod10 <= 4) return 'монеты';
  return 'монет';
}
