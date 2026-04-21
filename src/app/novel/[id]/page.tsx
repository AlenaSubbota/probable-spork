import { createClient } from '@/utils/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import NovelCard from '@/components/NovelCard';

interface PageProps {
  params: Promise<{ id: string }>;
}

function getCoverUrl(path: string | null) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `https://tene.fun/storage/v1/object/public/covers/${path}`;
}

function formatChapterDate(published: string | null) {
  if (!published) return '';
  const date = new Date(published);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) {
    return `сегодня, ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (diffDays === 1) {
    return `вчера, ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (diffDays < 7) return `${diffDays} дн. назад`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} нед. назад`;
  return date.toLocaleDateString('ru-RU');
}

function formatCount(n: number | null | undefined) {
  if (!n) return '0';
  if (n >= 1000) {
    return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`.replace('.0', '');
  }
  return n.toLocaleString('ru-RU');
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

  const { data: chaptersDesc } = await supabase
    .from('chapters')
    .select('id, chapter_number, title, is_paid, published_at')
    .eq('novel_id', novel.id)
    .order('chapter_number', { ascending: false });

  const chapters = chaptersDesc ?? [];
  const firstChapterNumber =
    chapters.length > 0 ? chapters[chapters.length - 1].chapter_number : 1;

  const { data: similarNovels } = novel.author
    ? await supabase
        .from('novels_view')
        .select('*')
        .eq('author', novel.author)
        .neq('firebase_id', novel.firebase_id)
        .limit(6)
    : { data: [] };

  const coverUrl = getCoverUrl(novel.cover_url);
  const genres: string[] = Array.isArray(novel.genres) ? novel.genres : [];
  const primaryGenre = genres[0];
  const authorInitial = (novel.author || 'A').trim().charAt(0).toUpperCase();

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
                {novel.average_rating > 0 ? novel.average_rating.toFixed(1) : '—'}
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
                  {novel.average_rating > 0 ? novel.average_rating.toFixed(1) : '—'}
                </div>
                <div className="label">
                  {novel.rating_count || 0}{' '}
                  {novel.rating_count === 1 ? 'оценка' : 'оценок'}
                </div>
              </div>
              <div className="metric">
                <div className="val">{chapters.length}</div>
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
                Читать с {firstChapterNumber}-й главы
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

        <div className="chapter-list">
          <div className="chapter-list-head">
            <h3>Главы ({chapters.length})</h3>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>Сортировка:</span>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ height: 32, padding: '0 12px', fontSize: 13 }}
              >
                Новые сверху
              </button>
            </div>
          </div>

          {chapters.length === 0 && (
            <div style={{ padding: 20, color: 'var(--ink-mute)' }}>Глав пока нет.</div>
          )}

          {chapters.map((chapter) => {
            const displayTitle = chapter.title
              ? `Глава ${chapter.chapter_number}. ${chapter.title}`
              : `Глава ${chapter.chapter_number}`;
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

        {similarNovels && similarNovels.length > 0 && (
          <>
            <div className="section-head">
              <h2>Похожее от {novel.author}</h2>
            </div>
            <div className="novel-grid">
              {similarNovels.map((n, index) => (
                <NovelCard
                  key={n.id}
                  id={n.firebase_id}
                  title={n.title}
                  translator={n.author || 'Автор'}
                  metaInfo={`${n.rating_count || 0} оценок`}
                  rating={n.average_rating ? n.average_rating.toFixed(1) : '—'}
                  coverUrl={getCoverUrl(n.cover_url)}
                  placeholderClass={`p${(index % 8) + 1}`}
                  placeholderText={n.title.substring(0, 16)}
                />
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}