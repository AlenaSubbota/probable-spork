import { createClient } from '@/utils/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { sanitizeUgcHtml, safeUrl } from '@/lib/sanitize';
import NovelCard from '@/components/NovelCard';
import FirstChapterPreview from '@/components/FirstChapterPreview';
import SimilarByReaders from '@/components/SimilarByReaders';
import ReleasePace from '@/components/ReleasePace';
import NovelCredits, { type CreditRow } from '@/components/novel/NovelCredits';
import MyNovelHistory from '@/components/novel/MyNovelHistory';
import NovelHero from '@/components/novel/NovelHero';
import { getCoverUrl, cleanGenres } from '@/lib/format';
import { fetchTranslators } from '@/lib/translator';

interface PageProps {
  params: Promise<{ id: string }>;
}

// generateMetadata: динамические OG/Twitter-метаданные на превью в
// Telegram/VK/Twitter. Метаданные тут — для канонического URL
// /novel/<id>; подстраницы /chapters и /reviews наследуют title.template
// из RootLayout.
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();

  const { data: novel } = await supabase
    .from('novels_view')
    .select('title, description, cover_url, author, moderation_status, age_rating')
    .eq('firebase_id', id)
    .maybeSingle();

  if (!novel || novel.moderation_status !== 'published') {
    return { title: 'Новелла не найдена', robots: { index: false, follow: false } };
  }

  const rawDesc = String(novel.description ?? '');
  const plainDesc = rawDesc
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const description = plainDesc.length > 0
    ? (plainDesc.length > 200 ? plainDesc.slice(0, 197) + '…' : plainDesc)
    : `Читайте «${novel.title}» онлайн на Chaptify`;

  const cover = getCoverUrl(novel.cover_url);
  const url = `/novel/${id}`;

  return {
    title: novel.title,
    description,
    openGraph: {
      type: 'article',
      title: novel.title,
      description,
      url,
      images: cover ? [{ url: cover, alt: novel.title }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: novel.title,
      description,
      images: cover ? [cover] : undefined,
    },
    robots: novel.age_rating === '18+'
      ? { index: false, follow: false }
      : { index: true, follow: true },
    alternates: { canonical: url },
  };
}

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

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// «О тайтле» — корневая страница карточки новеллы.
//   Шапка с обложкой/звёздами/действиями/табами рендерится через NovelHero.
//   Сюда падает контент таба: описание, превью, темп, оригинал-ссылки,
//   credits, личная история, похожее.
export default async function NovelInfoPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: novel } = await supabase
    .from('novels_view')
    .select('*')
    .eq('firebase_id', id)
    .maybeSingle();

  if (!novel) notFound();

  // Профиль читателя — нужен для canEdit-чека (NovelHero делает то же
  // самое, но мы хотим скрыть draft/scheduled данные ещё на этом уровне).
  const { data: viewerProfile } = user
    ? await supabase
        .from('profiles')
        .select('role, is_admin')
        .eq('id', user.id)
        .maybeSingle()
    : { data: null };
  const vp = viewerProfile as { role?: string; is_admin?: boolean } | null;
  const viewerIsAdmin = vp?.is_admin === true || vp?.role === 'admin';
  const canEdit = !!user && (novel.translator_id === user.id || viewerIsAdmin);

  if (novel.moderation_status !== 'published' && !canEdit) {
    notFound();
  }

  // Translator profile — нужен для блока «Похожее от <переводчик>».
  let translatorProfile: { displayName: string | null } | null = null;
  if (novel.translator_id) {
    const { data: tp } = await supabase
      .from('profiles')
      .select('translator_display_name, user_name')
      .eq('id', novel.translator_id)
      .maybeSingle();
    const p = tp as { translator_display_name?: string | null; user_name?: string | null } | null;
    if (p) {
      translatorProfile = {
        displayName: p.translator_display_name || p.user_name || null,
      };
    }
  }

  // Novel credits (команда новеллы — переводчик/редактор/корректор/...)
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

  // Чтобы блок «Над новеллой работают» не пустовал у одиночек, добавляем
  // виртуальную строку с главным переводчиком, если в novel_translators
  // нет записей.
  if (novelCredits.length === 0 && novel.translator_id) {
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
      const display = p.translator_display_name || p.user_name || null;
      novelCredits = [
        {
          id: -1,
          user_id: novel.translator_id,
          role: 'translator',
          share_percent: 100,
          note: null,
          user_name: display,
          avatar_url: p.translator_avatar_url ?? null,
          translator_slug: p.translator_slug || p.user_name || null,
          display_name: display,
        },
      ];
    }
  }

  // Параллельно: первая глава для превью + similar + release pace
  const nowIso = new Date().toISOString();
  const [
    { data: firstChapterRow },
    { data: similarByReaders },
    { data: paceRaw },
  ] = await Promise.all([
    supabase
      .from('chapters')
      .select('chapter_number, content_path')
      .eq('novel_id', novel.id)
      .not('published_at', 'is', null)
      .lte('published_at', nowIso)
      .order('chapter_number', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase.rpc('get_similar_novels_by_readers', { p_novel_id: novel.id, p_limit: 6 }),
    supabase.rpc('get_release_pace', { p_novel_id: novel.id, p_days: 90 }),
  ]);

  const firstChapter = firstChapterRow ?? null;
  const firstChapterNumber = firstChapter?.chapter_number ?? 1;

  // Личная история читателя
  let myHistory: {
    currentChapter: number | null;
    startedAt: string | null;
    quotesCount: number;
    thanksCount: number;
    activeDays: number;
  } | null = null;
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
      const currentChapter =
        typeof entry?.chapterId === 'number' && entry.chapterId > 0
          ? entry.chapterId
          : null;
      const startedAt = entry?.timestamp ?? null;

      const [{ count: qCount }, { count: tCount }] = await Promise.all([
        supabase
          .from('user_quotes')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('novel_id', novel.id),
        supabase
          .from('chapter_thanks')
          .select('user_id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('novel_id', novel.id),
      ]);

      let activeDays = 0;
      if (startedAt) {
        const diff = Math.floor((Date.now() - new Date(startedAt).getTime()) / 86_400_000);
        activeDays = Math.max(0, diff);
      }

      myHistory = {
        currentChapter,
        startedAt,
        quotesCount: qCount ?? 0,
        thanksCount: tCount ?? 0,
        activeDays,
      };
    } catch {
      myHistory = null;
    }
  }

  // Fallback similar (если по читателям ничего не пришло) — взвешенный
  // пул по переводчику/жанрам/автору/стране.
  let fallbackSimilar: unknown[] = [];
  if (!similarByReaders || similarByReaders.length === 0) {
    const currentGenres = cleanGenres(novel.genres);

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

  // Превью первого абзаца
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
        const charCount = rawHtml.replace(/<[^>]+>/g, '').length;
        previewMinutes = Math.max(1, Math.round(charCount / 1500));
      }
    } catch {
      // молча — превью необязательно
    }
  }

  // Slug map для блоков «Похожее».
  const similarTranslatorMap = await fetchTranslators(
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

  // Используем для счётчика глав. NovelHero показывает novel.chapter_count,
  // а здесь нужно для блока «Личная история» (totalChapters). Делаем
  // отдельный count-only запрос на тот случай, если novel.chapter_count
  // в view устарел.
  const { count: totalChapters } = await supabase
    .from('chapters')
    .select('id', { count: 'exact', head: true })
    .eq('novel_id', novel.id)
    .not('published_at', 'is', null)
    .lte('published_at', nowIso);

  return (
    <main>
      <NovelHero firebaseId={id} />

      <section className="container">
        {novel.description && (
          <div className="desc">
            <strong>Описание.</strong>{' '}
            <span dangerouslySetInnerHTML={{ __html: sanitizeUgcHtml(novel.description) }} />
          </div>
        )}

        {previewText && (
          <FirstChapterPreview
            novelFirebaseId={novel.firebase_id}
            firstChapterNumber={firstChapterNumber}
            previewText={previewText}
            readingMinutes={previewMinutes}
          />
        )}

        {paceRaw && paceRaw.length > 0 && (
          <ReleasePace
            days={paceRaw.map((d: { day: string; chapters: number }) => ({
              day: d.day,
              chapters: d.chapters,
            }))}
            totalChapters={totalChapters ?? 0}
            isCompleted={!!novel.is_completed}
          />
        )}

        {Array.isArray(novel.external_links) && novel.external_links.length > 0 && (
          <section className="external-links-block">
            <h3 className="external-links-title">Оригинал</h3>
            <div className="external-links-list">
              {(novel.external_links as Array<{ label: string; url: string }>).map(
                (link, i) => {
                  const safe = safeUrl(link.url);
                  return safe ? (
                    <a
                      key={i}
                      href={safe}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="external-link"
                    >
                      <span>{link.label || hostnameOf(safe)}</span>
                      <span className="external-link-arrow" aria-hidden="true">↗</span>
                    </a>
                  ) : null;
                }
              )}
            </div>
          </section>
        )}

        <NovelCredits credits={novelCredits as CreditRow[]} />

        {myHistory && (
          <MyNovelHistory
            novelId={novel.id}
            novelFirebaseId={novel.firebase_id}
            totalChapters={totalChapters ?? 0}
            currentChapter={myHistory.currentChapter}
            startedAt={myHistory.startedAt}
            quotesCount={myHistory.quotesCount}
            thanksCount={myHistory.thanksCount}
            activeDays={myHistory.activeDays}
            novelIsCompleted={!!novel.is_completed}
          />
        )}

        {similarByReaders && similarByReaders.length > 0 && (
          <SimilarByReaders novels={similarByReaders} translators={similarTranslatorMap} />
        )}

        {(!similarByReaders || similarByReaders.length === 0) && fallbackSimilar.length > 0 && (
          <>
            <div className="section-head">
              <h2>
                {translatorProfile?.displayName
                  ? `Похожее от ${translatorProfile.displayName}`
                  : 'Похожие новеллы'}
              </h2>
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
              }>).map((n, index) => {
                const info = n.translator_id ? similarTranslatorMap.get(n.translator_id) : null;
                return (
                  <NovelCard
                    key={n.id}
                    id={n.firebase_id}
                    title={n.title}
                    translator={info?.name || 'Переводчик'}
                    translatorSlug={info?.slug ?? null}
                    metaInfo={`${n.rating_count || 0} оценок`}
                    rating={n.average_rating ? Number(n.average_rating).toFixed(1) : '—'}
                    coverUrl={getCoverUrl(n.cover_url)}
                    placeholderClass={`p${(index % 8) + 1}`}
                    placeholderText={n.title.substring(0, 16)}
                    chapterCount={n.chapter_count}
                  />
                );
              })}
            </div>
          </>
        )}

        {/* Подсказка для перехода на главы — на info-табе видно сразу. */}
        {(totalChapters ?? 0) > 0 && (
          <div style={{ textAlign: 'center', marginTop: 32 }}>
            <Link
              href={`/novel/${novel.firebase_id}/chapters`}
              className="btn btn-ghost"
            >
              Список глав ({totalChapters}) →
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
