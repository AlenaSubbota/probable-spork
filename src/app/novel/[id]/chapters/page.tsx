import { createClient } from '@/utils/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import NovelHero from '@/components/novel/NovelHero';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}

const CHAPTERS_PER_PAGE = 50;

// Страница «Главы» — отдельный роут /novel/<id>/chapters. Шапка через
// общий <NovelHero>; ниже — список глав с пагинацией, доступ-маркерами
// (платная/бесплатная/куплено/подписка/команда).
export default async function NovelChaptersPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { page: pageRaw } = await searchParams;
  const page = Math.max(1, parseInt(pageRaw ?? '1', 10) || 1);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: novel } = await supabase
    .from('novels_view')
    .select('id, firebase_id, translator_id, moderation_status')
    .eq('firebase_id', id)
    .maybeSingle();

  if (!novel) notFound();

  // Тот же canEdit-флаг, что и в NovelHero — нужен, чтобы переводчику
  // и админу показать draft/scheduled-главы и кнопки «Править».
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

  const { data: chaptersDesc, count: chaptersCount } = await chaptersQuery;
  const chapters = chaptersDesc ?? [];
  const totalChapters = chaptersCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalChapters / CHAPTERS_PER_PAGE));

  // Какие главы уже куплены — для маркера ✓ куплено.
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

  // Активная подписка — все платные считаются открытыми.
  let hasActiveSubscription = false;
  if (user && novel.translator_id) {
    const { data: sub } = await supabase
      .from('chaptify_subscriptions')
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

  // Расширенная команда (миграция 034 — переводчик/редактор/корректор)
  // читает платные главы бесплатно.
  const isTeam = canEdit;
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

  return (
    <main>
      <NovelHero firebaseId={id} />

      <section className="container">
        <div id="chapters" className="chapter-list">
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
                  href={`/novel/${novel.firebase_id}/chapters${page === 2 ? '' : `?page=${page - 1}`}`}
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
                  href={`/novel/${novel.firebase_id}/chapters?page=${page + 1}`}
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
      </section>
    </main>
  );
}

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

function pluralCoins(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return 'монет';
  if (mod10 === 1) return 'монета';
  if (mod10 >= 2 && mod10 <= 4) return 'монеты';
  return 'монет';
}
