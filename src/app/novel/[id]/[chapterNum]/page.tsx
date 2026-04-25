import { createClient } from '@/utils/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import ReaderContent from '@/components/ReaderContent';
import CommentsSection from '@/components/CommentsSection';
import ChapterThanks from '@/components/reader/ChapterThanks';
import ChapterPaywall from '@/components/reader/ChapterPaywall';
import SimilarByReaders from '@/components/SimilarByReaders';
import { fetchTranslators } from '@/lib/translator';

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
  // Иначе пробуем RPC can_read_chapter_chaptify (миграция 036). Это
  // chaptify-специфичная обёртка — пропускает автора, команду из
  // novel_translators и админа; остальное делегирует общему
  // can_read_chapter (который tene не меняем).
  let hasAccess = !chapter.is_paid;
  if (chapter.is_paid && user) {
    try {
      const { data: allowed } = await supabase.rpc('can_read_chapter_chaptify', {
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
    // Подтягиваем: баланс, данные переводчика, его pmethods, мой
    // pending-claim (если есть).
    const [
      { data: profileRaw },
      { data: tp },
      { data: myClaim },
      { data: methodsRaw },
    ] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      novel.translator_id
        ? supabase
            .from('profiles')
            .select(
              'translator_slug, user_name, translator_display_name, accepts_coins_for_chapters'
            )
            .eq('id', novel.translator_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      novel.translator_id
        ? supabase
            .from('subscription_claims')
            .select('id, code, status, external_username, tier_months')
            .eq('user_id', user.id)
            .eq('translator_id', novel.translator_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      novel.translator_id
        ? supabase
            .from('translator_payment_methods')
            .select('id, provider, url, instructions, tg_chat_id')
            .eq('translator_id', novel.translator_id)
            .eq('enabled', true)
            .order('sort_order', { ascending: true })
        : Promise.resolve({ data: [] }),
    ]);
    // Баланс монет читателя у ЭТОГО переводчика (per-translator wallet,
    // мигр. 045). У каждого переводчика свой кошелёк, общий global-баланс
    // (profiles.coin_balance) остался legacy-полем для tene. Если RPC
    // ещё не накачена — падаем в 0.
    let balance = 0;
    if (novel.translator_id) {
      try {
        const { data: walletBalance } = await supabase.rpc('my_balance_with', {
          p_translator: novel.translator_id,
        });
        if (typeof walletBalance === 'number') balance = walletBalance;
      } catch {
        // миграция 045 не накачена — fallback на legacy coin_balance
        balance =
          (profileRaw as { coin_balance?: number | null } | null)?.coin_balance ?? 0;
      }
    }
    const viewerHasTelegram =
      !!(profileRaw as { telegram_id?: number | null } | null)?.telegram_id;
    const tpAny = tp as {
      translator_slug?: string | null;
      user_name?: string | null;
      translator_display_name?: string | null;
      accepts_coins_for_chapters?: boolean | null;
    } | null;
    const translatorSlug = tpAny?.translator_slug || tpAny?.user_name || null;
    const translatorName =
      tpAny?.translator_display_name || tpAny?.user_name || null;
    // По умолчанию монеты принимаются (обратная совместимость с
    // существующими профилями, где поле ещё NULL до миграции 037)
    const acceptsCoins = tpAny?.accepts_coins_for_chapters !== false;

    // Тянем также tg_chat_id — для автосинка в ClaimBlock
    const { data: methodsWithChat } = novel.translator_id
      ? await supabase
          .from('translator_payment_methods')
          .select('id, provider, url, instructions, tg_chat_id')
          .eq('translator_id', novel.translator_id)
          .eq('enabled', true)
          .order('sort_order', { ascending: true })
      : { data: [] };

    const paymentMethods = ((methodsWithChat ?? methodsRaw ?? []) as Array<{
      id: number;
      provider: 'boosty' | 'tribute' | 'vk_donut' | 'patreon' | 'other';
      url: string;
      instructions: string | null;
      tg_chat_id?: number | null;
    }>);

    // Фильтр: показываем pending/declined claim, чтобы юзер видел статус;
    // approved — тогда бы hasAccess уже был бы true (но на всякий случай
    // не передаём, чтобы не путать).
    const claimRow = myClaim as {
      id: number;
      code: string;
      status: 'pending' | 'approved' | 'declined';
      external_username: string | null;
      tier_months: number;
    } | null;
    const existingClaim =
      claimRow && claimRow.status !== 'approved' ? claimRow : null;

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
            translatorId={novel.translator_id ?? null}
            translatorName={translatorName}
            paymentMethods={paymentMethods}
            acceptsCoins={acceptsCoins}
            viewerHasTelegram={viewerHasTelegram}
            existingClaim={existingClaim}
          />
        </main>
      </div>
    );
  }

  // Загружаем текст + глоссарий.
  //
  // Для анонимных читателей бесплатной главы supabase.storage.download
  // валится с RLS ошибкой (bucket chapter_content обычно требует
  // authenticated). Проксируем через auth-service-chaptify, который
  // через service_role отдаёт тело бесплатной главы без RLS-боли.
  // Платные главы скачиваем через supabase.storage — только если уже
  // есть доступ (hasAccess), юзер залогинен, bucket-policy разрешит.
  const shouldUseProxy = !user && !chapter.is_paid && !!chapter.content_path;

  const fetchChapterText = async (): Promise<string | null> => {
    if (!chapter.content_path) return null;
    if (shouldUseProxy) {
      try {
        // SSR fetch требует абсолютный URL. AUTH_API_URL в build-time
        // залит как https://chaptify.ru; запрос уйдёт через наш же
        // nginx → auth-service-chaptify.
        const base = process.env.NEXT_PUBLIC_AUTH_API_URL || 'https://chaptify.ru';
        const url = `${base}/auth/free-chapter/${novel.id}/${chapter.chapter_number}`;
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) {
          return `<p style="color:var(--rose)">Не удалось загрузить текст: ${resp.status} ${resp.statusText}.</p>`;
        }
        return await resp.text();
      } catch (e) {
        return `<p style="color:var(--rose)">Не удалось загрузить текст: ${e instanceof Error ? e.message : 'сеть'}.</p>`;
      }
    }
    const { data: fileData, error: storageError } = await supabase.storage
      .from('chapter_content')
      .download(chapter.content_path);
    if (storageError || !fileData) {
      // Object not found = в БД глава есть, но файла в bucket нет (не загружен
      // или удалён). Сырое сообщение «Object not found» бесполезно для читателя,
      // подменяем на человеческое.
      const raw = storageError?.message ?? '';
      const isMissing = /not\s*found|404|object/i.test(raw);
      const human = isMissing
        ? 'Переводчик ещё не загрузил текст этой главы — попробуй позже или напиши ему/ей в личку через профиль.'
        : `Не удалось загрузить текст: ${raw || 'неизвестная ошибка'}.`;
      return `<p style="color:var(--rose)">${human}</p>`;
    }
    return await fileData.text();
  };

  const [rawText, { data: glossaryRaw }] = await Promise.all([
    fetchChapterText(),
    supabase
      .from('novel_glossaries')
      .select('term_original, term_translation, category')
      .eq('novel_id', novel.id),
  ]);

  let finalContent = rawText ?? '';

  const glossary = (glossaryRaw ?? []).map((g) => ({
    term_original: g.term_original as string,
    term_translation: g.term_translation as string,
    category: (g.category as string | null) ?? null,
  }));

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

  // Имя переводчика для tip-блока под главой (ChapterThanks)
  let translatorDisplayName: string | null = null;
  if (novel.translator_id) {
    const { data: tProfile } = await supabase
      .from('profiles')
      .select('translator_display_name, user_name')
      .eq('id', novel.translator_id)
      .maybeSingle();
    const tp = tProfile as {
      translator_display_name?: string | null;
      user_name?: string | null;
    } | null;
    translatorDisplayName =
      tp?.translator_display_name || tp?.user_name || null;
  }

  // Похожие новеллы в конце главы — чтобы читатель после дочитанной
  // главы не застрял в пустоте, а плавно перешёл к следующей книге.
  // RPC `get_similar_novels_by_readers` из tene работает по таблице
  // `novel_ratings` (кто ставил 4+ этой же ставил 4+ вот этим).
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
    // RPC ещё не накачена — тихо пропускаем блок
  }

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
          glossary={glossary}
          novelFirebaseId={novel.firebase_id}
          novelTitle={novel.title}
          prevChapterNumber={prevChapter?.chapter_number ?? null}
          nextChapterNumber={nextChapter?.chapter_number ?? null}
        />

        {/* prev/next chapter переехали в sticky-панель снизу читалки
            (ReaderBottomBar). Здесь оставляем «К новелле» только если
            следующей главы нет — финальный аккорд после комментариев. */}
        {!nextChapter && (
          <nav className="reader-nav">
            <Link
              href={`/novel/${id}`}
              className="btn btn-ghost"
              style={{ flex: 1, textAlign: 'center' }}
            >
              К новелле
            </Link>
          </nav>
        )}

        <ChapterThanks
          novelId={novel.id}
          chapterNumber={chapter.chapter_number}
          hasTranslator={!!novel.translator_id}
          translatorDisplayName={translatorDisplayName}
          isLoggedIn={!!user}
        />

        <hr className="reader-divider" />

        <CommentsSection novelId={novel.id} chapterNumber={chapter.chapter_number} />
      </main>

      {/* «Созвучие читателей» — выносим за пределы .reader-main (max-width
          760), чтобы сетка из 4-6 обложек дышала по полной ширине
          .container, как на странице новеллы. Внутри узкой колонки
          цифры/обложки слипались и не помещались. */}
      {similarByReaders.length > 0 && (
        <section className="container reader-similar-out">
          <SimilarByReaders
            novels={similarByReaders}
            translators={similarTranslatorMap}
          />
        </section>
      )}
    </div>
  );
}
