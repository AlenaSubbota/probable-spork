import { createClient } from '@/utils/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import NovelCard from '@/components/NovelCard';
import FirstChapterPreview from '@/components/FirstChapterPreview';
import SimilarByReaders from '@/components/SimilarByReaders';
import ReleasePace from '@/components/ReleasePace';
import { getCoverUrl } from '@/lib/format';
import { formatReadingTime } from '@/lib/catalog';

interface PageProps {
  params: Promise<{ id: string }>;
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

export default async function NovelPage({ params }: PageProps) {
  const supabase = await createClient();
  const { id } = await params;

  const { data: novel, error: novelError } = await supabase
    .from('novels_view')
    .select('*')
    .eq('firebase_id', id)
    .single();

  if (novelError || !novel) notFound();

  // Параллельные запросы
  const [
    { data: chaptersDesc },
    { data: similarByReaders },
    { data: paceRaw },
  ] = await Promise.all([
    supabase
      .from('chapters')
      .select('id, chapter_number, is_paid, published_at, content_path')
      .eq('novel_id', novel.id)
      .order('chapter_number', { ascending: false }),
    supabase
      .rpc('get_similar_novels_by_readers', { p_novel_id: novel.id, p_limit: 6 }),
    supabase
      .rpc('get_release_pace', { p_novel_id: novel.id, p_days: 90 }),
  ]);

  const chapters = chaptersDesc ?? [];
  const totalChapters = chapters.length;
  const firstChapter = chapters.length > 0 ? chapters[chapters.length - 1] : null;

  // Fallback на «просто новеллы того же автора», если коллаборативки ещё нет
  let fallbackSimilar: unknown[] = [];
  if ((!similarByReaders || similarByReaders.length === 0) && novel.author) {
    const { data } = await supabase
      .from('novels_view')
      .select('*')
      .eq('author', novel.author)
      .neq('firebase_id', novel.firebase_id)
      .limit(6);
    fallbackSimilar = data ?? [];
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
  const authorInitial = (novel.author || 'A').trim().charAt(0).toUpperCase();
  const firstChapterNumber = firstChapter?.chapter_number ?? 1;

  return (
    <main>
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
            {novel.author && (
              <div className="subtitle">
                автор: {novel.author}
                {genres.length > 0 && ` · жанр: ${genres.slice(0, 3).join(', ')}`}
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
                  <span key={g} className="tag">
                    {g}
                  </span>
                ))}
              </div>
            )}

            {novel.author && (
              <div className="translator-card">
                <div className="avatar">{authorInitial}</div>
                <div style={{ flex: 1 }}>
                  <div className="name">{novel.author}</div>
                  <div className="role">Переводчик</div>
                </div>
                <span
                  className="btn btn-ghost"
                  style={{ pointerEvents: 'none', opacity: 0.6 }}
                >
                  Профиль
                </span>
              </div>
            )}

            <div className="actions-row">
              <Link
                href={`/novel/${novel.firebase_id}/${firstChapterNumber}`}
                className="btn btn-primary"
              >
                Читать с 1-й главы
              </Link>
              <button className="btn btn-ghost" type="button">
                ♥ В закладки
              </button>
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
            return (
              <div key={chapter.id} className="chapter-item">
                <div>
                  <div className="title">{displayTitle}</div>
                  <div className="date">{formatChapterDate(chapter.published_at)}</div>
                </div>
                <span className={`tag-price ${chapter.is_paid ? 'paid' : 'free'}`}>
                  {chapter.is_paid ? '10 монет' : 'Бесплатно'}
                </span>
                <Link
                  href={`/novel/${novel.firebase_id}/${chapter.chapter_number}`}
                  className={chapter.is_paid ? 'btn btn-ghost' : 'btn btn-primary'}
                  style={{ height: 32, padding: '0 14px', fontSize: 13 }}
                >
                  {chapter.is_paid ? 'Купить' : 'Читать'}
                </Link>
              </div>
            );
          })}
        </div>

        {/* Киллер-фича #2 — созвучие читателей */}
        {similarByReaders && similarByReaders.length > 0 && (
          <SimilarByReaders novels={similarByReaders} />
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
              }>).map((n, index) => (
                <NovelCard
                  key={n.id}
                  id={n.firebase_id}
                  title={n.title}
                  translator={n.author || 'Автор'}
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
