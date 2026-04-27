import { createClient } from '@/utils/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import CommentsSection from '@/components/CommentsSection';
import ChapterThanks from '@/components/reader/ChapterThanks';
import DiaryQuickEntry from '@/components/diary/DiaryQuickEntry';
import ThanksMessageForm from '@/components/thanks/ThanksMessageForm';
import SimilarByReaders from '@/components/SimilarByReaders';
import { fetchTranslators } from '@/lib/translator';

// Отдельная страница обсуждения главы.
//
// Зачем выносить в отдельный роут (а не оставлять в commentsSlot
// читалки):
// 1. Никакого «page in page» — обычный документ-flow, body
//    скроллится естественно, никаких overflow-конфликтов между
//    body и .reader-pages-end.
// 2. SiteFooter / SiteHeader работают как везде — никаких
//    костылей с display: none через :has().
// 3. Tap по textarea = клавиатура поднимается без артефактов
//    (нет фиксированных snap-скроллеров, которые надо учитывать).
// 4. Сетка «Созвучие читателей» получает обычную ширину
//    .reader-main (760px) или .container — больше не «выезжает».
//
// На странице главы (chapter page.tsx) commentsSlot заменяется
// на минимальный nav: «Следующая глава →» + ссылка «Обсудить
// главу» которая ведёт сюда.

interface PageProps {
  params: Promise<{ id: string; chapterNum: string }>;
}

export default async function ChapterDiscussionPage({ params }: PageProps) {
  const supabase = await createClient();
  const { id, chapterNum } = await params;
  const num = parseInt(chapterNum, 10);

  const { data: novel } = await supabase
    .from('novels')
    .select('id, title, firebase_id, translator_id, moderation_status')
    .eq('firebase_id', id)
    .single();

  if (!novel) notFound();

  const { data: { user } } = await supabase.auth.getUser();

  // Неопубликованные новеллы видит только переводчик / админ.
  if (novel.moderation_status !== 'published') {
    if (!user) notFound();
    const { data: viewer } = await supabase
      .from('profiles')
      .select('role, is_admin')
      .eq('id', user.id)
      .maybeSingle();
    const v = viewer as { role?: string; is_admin?: boolean } | null;
    const isAdmin = v?.is_admin === true || v?.role === 'admin';
    if (!isAdmin && novel.translator_id !== user.id) notFound();
  }

  const { data: chapter } = await supabase
    .from('chapters')
    .select('chapter_number, published_at')
    .eq('novel_id', novel.id)
    .eq('chapter_number', num)
    .single();

  if (!chapter) notFound();

  // Запланированные / черновики тоже видят только владельцы.
  const publishedMs = chapter.published_at
    ? new Date(chapter.published_at).getTime()
    : null;
  const isDraftOrScheduled = publishedMs === null || publishedMs > Date.now();
  if (isDraftOrScheduled) {
    if (!user) notFound();
    const { data: viewerRoleRow } = await supabase
      .from('profiles')
      .select('role, is_admin')
      .eq('id', user.id)
      .maybeSingle();
    const vr = viewerRoleRow as { role?: string; is_admin?: boolean } | null;
    const viewerIsAdminHere = vr?.is_admin === true || vr?.role === 'admin';
    if (!viewerIsAdminHere && novel.translator_id !== user.id) notFound();
  }

  // Имя + slug переводчика для пост-главных блоков.
  let translatorDisplayName: string | null = null;
  let translatorSlugMain: string | null = null;
  if (novel.translator_id) {
    const { data: tProfile } = await supabase
      .from('profiles')
      .select('translator_display_name, user_name, translator_slug')
      .eq('id', novel.translator_id)
      .maybeSingle();
    const tp = tProfile as {
      translator_display_name?: string | null;
      user_name?: string | null;
      translator_slug?: string | null;
    } | null;
    translatorDisplayName =
      tp?.translator_display_name || tp?.user_name || null;
    translatorSlugMain = tp?.translator_slug || tp?.user_name || null;
  }

  // Соседние главы для навигации (читать дальше).
  const nowIso = new Date().toISOString();
  const nextQuery = supabase
    .from('chapters')
    .select('chapter_number')
    .eq('novel_id', novel.id)
    .gt('chapter_number', num)
    .order('chapter_number', { ascending: true })
    .limit(1);
  if (!isDraftOrScheduled) {
    nextQuery.not('published_at', 'is', null).lte('published_at', nowIso);
  }
  const { data: nextRow } = await nextQuery.maybeSingle();
  const nextChapter = nextRow;

  // Похожие новеллы (тот же RPC что в читалке).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let similarByReaders: any[] = [];
  let similarTranslatorMap: Map<string, { slug: string; name: string }> = new Map();
  try {
    const { data } = await supabase.rpc('get_similar_novels_by_readers', {
      p_novel_id: novel.id,
      p_limit: 6,
    });
    if (Array.isArray(data) && data.length > 0) {
      similarByReaders = data;
      const ids = (data as Array<{ translator_id?: string | null }>)
        .map((n) => n.translator_id)
        .filter((v): v is string => !!v);
      similarTranslatorMap = await fetchTranslators(supabase, ids);
    }
  } catch {
    // RPC ещё не накачена — тихо пропускаем
  }

  return (
    <main className="container" style={{ paddingTop: 24, paddingBottom: 80 }}>
      <div style={{ marginBottom: 18 }}>
        <Link
          href={`/novel/${id}/${chapter.chapter_number}`}
          className="reader-back"
          style={{ fontSize: 14 }}
        >
          ← Глава {chapter.chapter_number} · {novel.title}
        </Link>
      </div>

      <h1
        style={{
          fontFamily: 'var(--font-serif)',
          fontSize: 28,
          margin: '0 0 24px',
        }}
      >
        Обсуждение · Глава {chapter.chapter_number}
      </h1>

      {/* Кнопка «Следующая глава» — мотивация двигаться по новелле,
          а не зависать в обсуждении. */}
      {nextChapter && (
        <nav className="reader-nav" style={{ marginBottom: 24 }}>
          <Link
            href={`/novel/${id}/${nextChapter.chapter_number}`}
            className="btn btn-primary"
            style={{ flex: 1, textAlign: 'center' }}
          >
            Следующая глава →
          </Link>
        </nav>
      )}

      {/* Пост-главные блоки (благодарности / дневник / письмо) +
          комменты — те же компоненты что раньше жили в commentsSlot
          читалки, теперь в полноценной странице с правильным flow. */}
      <CommentsSection
        novelId={novel.id}
        chapterNumber={chapter.chapter_number}
        topSlot={
          <>
            <ChapterThanks
              novelId={novel.id}
              chapterNumber={chapter.chapter_number}
              hasTranslator={!!novel.translator_id}
              translatorDisplayName={translatorDisplayName}
              isLoggedIn={!!user}
            />
            <DiaryQuickEntry
              novelId={novel.id}
              chapterNumber={chapter.chapter_number}
              isLoggedIn={!!user}
            />
            {novel.translator_id && (
              <ThanksMessageForm
                translatorId={novel.translator_id}
                translatorDisplayName={translatorDisplayName}
                novelId={novel.id}
                chapterNumber={chapter.chapter_number}
                isLoggedIn={!!user}
                currentUserId={user?.id ?? null}
                translatorSlug={translatorSlugMain}
              />
            )}
          </>
        }
      />

      {similarByReaders.length > 0 && (
        <div style={{ marginTop: 40 }}>
          <SimilarByReaders
            novels={similarByReaders}
            translators={similarTranslatorMap}
          />
        </div>
      )}
    </main>
  );
}
