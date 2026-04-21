import { createClient } from '@/utils/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import ReaderContent from '@/components/ReaderContent';
import CommentsSection from '@/components/CommentsSection';
import ChapterPaywall from '@/components/reader/ChapterPaywall';

interface PageProps {
  params: Promise<{ id: string; chapterNum: string }>;
}

export default async function ChapterPage({ params }: PageProps) {
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

  // Неопубликованные новеллы: читать главы могут только переводчик / админ
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
    .select('id, chapter_number, is_paid, content_path, published_at, price_coins')
    .eq('novel_id', novel.id)
    .eq('chapter_number', num)
    .single();

  if (!chapter) notFound();

  // Черновики и запланированные главы видит только переводчик / админ.
  // Остальным — 404 (как будто главы просто не существует).
  const publishedMs = chapter.published_at
    ? new Date(chapter.published_at).getTime()
    : null;
  const isDraftOrScheduled =
    publishedMs === null || publishedMs > Date.now();
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

  // Проверяем доступ. Если глава бесплатная — сразу пускаем.
  // Иначе пробуем RPC can_read_chapter (после миграции 001). Если RPC нет
  // или бросает ошибку — фоллбэк: пускаем всех (не ломаем beta-флоу tene).
  let hasAccess = !chapter.is_paid;
  if (chapter.is_paid && user) {
    try {
      const { data: allowed } = await supabase.rpc('can_read_chapter', {
        p_user: user.id,
        p_novel: novel.id,
        p_chapter: chapter.chapter_number,
      });
      if (typeof allowed === 'boolean') {
        hasAccess = allowed;
      } else {
        hasAccess = true; // RPC вернула неожиданное — не блокируем
      }
    } catch {
      hasAccess = true;
    }
  }

  // Платная глава + анонимный читатель → на логин, не отдаём текст
  if (chapter.is_paid && !user) {
    const redirectTo = encodeURIComponent(`/novel/${id}/${chapter.chapter_number}`);
    return (
      <div className="reader-page">
        <main className="reader-main">
          <div className="paywall">
            <div className="paywall-icon" aria-hidden="true">🔒</div>
            <h2 className="paywall-title">Нужен аккаунт</h2>
            <p className="paywall-sub">
              Эта глава платная. Войди, чтобы купить её или открыть
              по подписке переводчика.
            </p>
            <Link
              href={`/login?next=${redirectTo}`}
              className="btn btn-primary"
              style={{ width: '100%', maxWidth: 260 }}
            >
              Войти
            </Link>
            <Link
              href={`/novel/${id}`}
              className="paywall-back"
              style={{ marginTop: 14 }}
            >
              ← Назад к списку глав
            </Link>
          </div>
        </main>
      </div>
    );
  }

  // Если нет доступа — показываем paywall, не тянем текст
  if (!hasAccess && user) {
    // Подтягиваем баланс + slug переводчика для UI paywall
    const [{ data: profileRaw }, { data: tp }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      novel.translator_id
        ? supabase
            .from('profiles')
            .select('translator_slug, user_name')
            .eq('id', novel.translator_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const balance =
      (profileRaw as { coin_balance?: number | null } | null)?.coin_balance ?? 0;
    const tpAny = tp as { translator_slug?: string | null; user_name?: string | null } | null;
    const translatorSlug = tpAny?.translator_slug || tpAny?.user_name || null;

    return (
      <div className="reader-page">
        <header className="reader-header">
          <div className="container reader-header-row">
            <Link href={`/novel/${id}`} className="reader-back">
              ← {novel.title}
            </Link>
            <div className="reader-chapter-num">Глава {chapter.chapter_number}</div>
            <div className="reader-header-spacer" />
          </div>
        </header>
        <main className="reader-main">
          <ChapterPaywall
            novelId={novel.id}
            novelFirebaseId={novel.firebase_id}
            novelTitle={novel.title}
            chapterNumber={chapter.chapter_number}
            chapterPrice={chapter.price_coins ?? 10}
            userBalance={balance}
            translatorSlug={translatorSlug}
          />
        </main>
      </div>
    );
  }

  // Загружаем текст из storage
  let finalContent = '';
  if (chapter.content_path) {
    const { data: fileData, error: storageError } = await supabase.storage
      .from('chapter_content')
      .download(chapter.content_path);

    if (!storageError && fileData) {
      finalContent = await fileData.text();
    } else {
      finalContent = `<p style="color:var(--rose)">Не удалось загрузить текст: ${storageError?.message ?? 'неизвестная ошибка'}.</p>`;
    }
  }

  if (!finalContent) {
    finalContent = '<p><em>Текст главы отсутствует.</em></p>';
  }

  // Соседние главы. Читатели не должны переходить в черновики/запланированные:
  // берём ближайшие видимые, не обязательно соседние по номеру.
  const nowIso = new Date().toISOString();
  const prevQuery = supabase
    .from('chapters')
    .select('chapter_number')
    .eq('novel_id', novel.id)
    .lt('chapter_number', num)
    .order('chapter_number', { ascending: false })
    .limit(1);
  const nextQuery = supabase
    .from('chapters')
    .select('chapter_number')
    .eq('novel_id', novel.id)
    .gt('chapter_number', num)
    .order('chapter_number', { ascending: true })
    .limit(1);
  if (isDraftOrScheduled) {
    // владелец в предпросмотре — видит всё, чтобы переходить между draft/scheduled
  } else {
    prevQuery.not('published_at', 'is', null).lte('published_at', nowIso);
    nextQuery.not('published_at', 'is', null).lte('published_at', nowIso);
  }
  const [{ data: prevRow }, { data: nextRow }] = await Promise.all([
    prevQuery.maybeSingle(),
    nextQuery.maybeSingle(),
  ]);
  const prevChapter = prevRow;
  const nextChapter = nextRow;

  return (
    <div className="reader-page">
      <header className="reader-header">
        <div className="container reader-header-row">
          <Link href={`/novel/${id}`} className="reader-back">
            ← {novel.title}
          </Link>
          <div className="reader-chapter-num">Глава {chapter.chapter_number}</div>
          <div className="reader-header-spacer" />
        </div>
      </header>

      <main className="reader-main">
        {isDraftOrScheduled && (
          <div className="preview-banner" role="status">
            <span className="preview-banner-icon" aria-hidden="true">
              {publishedMs === null ? '📝' : '⏰'}
            </span>
            <div>
              <div className="preview-banner-title">
                {publishedMs === null
                  ? 'Это черновик'
                  : 'Запланированная публикация'}
              </div>
              <div className="preview-banner-sub">
                {publishedMs === null
                  ? 'Главу видишь только ты. Читателям она откроется, когда переключишь статус в редакторе.'
                  : `Откроется читателям ${new Date(chapter.published_at!).toLocaleString('ru-RU')}`}
              </div>
            </div>
          </div>
        )}

        <h1 className="reader-title">Глава {chapter.chapter_number}</h1>

        <ReaderContent
          content={finalContent}
          novelId={novel.id}
          chapterNumber={chapter.chapter_number}
        />

        <nav className="reader-nav">
          {prevChapter ? (
            <Link
              href={`/novel/${id}/${prevChapter.chapter_number}`}
              className="btn btn-ghost"
              style={{ flex: 1, textAlign: 'center' }}
            >
              ← Глава {prevChapter.chapter_number}
            </Link>
          ) : (
            <div style={{ flex: 1 }} />
          )}

          {nextChapter ? (
            <Link
              href={`/novel/${id}/${nextChapter.chapter_number}`}
              className="btn btn-primary"
              style={{ flex: 1, textAlign: 'center' }}
            >
              Глава {nextChapter.chapter_number} →
            </Link>
          ) : (
            <Link
              href={`/novel/${id}`}
              className="btn btn-ghost"
              style={{ flex: 1, textAlign: 'center' }}
            >
              К новелле
            </Link>
          )}
        </nav>

        <hr className="reader-divider" />

        <CommentsSection novelId={novel.id} chapterNumber={chapter.chapter_number} />
      </main>
    </div>
  );
}
