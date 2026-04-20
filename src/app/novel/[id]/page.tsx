import { createClient } from '@/utils/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function NovelPage({ params }: PageProps) {
  const supabase = await createClient();
  const resolvedParams = await params;

  const { data: novel, error: novelError } = await supabase
    .from('novels_view')
    .select('*')
    .eq('firebase_id', resolvedParams.id)
    .single();

  if (novelError || !novel) notFound();

  const { data: chapters } = await supabase
    .from('chapters')
    .select('id, chapter_number, is_paid, published_at, like_count')
    .eq('novel_id', novel.id)
    .order('chapter_number', { ascending: false });

  // Формируем правильную ссылку на обложку из Supabase Storage
  // Если в БД уже лежит полная ссылка (http...), оставляем её. 
  // Если просто имя файла — собираем путь к бакету 'covers'.
  const getCoverUrl = (path: string | null) => {
    if (!path) return null;
    if (path.startsWith('http')) return path;
    return `https://tene.fun/storage/v1/object/public/covers/${path}`;
  };

  const coverUrl = getCoverUrl(novel.cover_url);
  const genresList = Array.isArray(novel.genres) ? novel.genres.join(', ') : 'Жанры не указаны';

  return (
    <main className="container section">
      <div className="section-head" style={{ marginBottom: '32px' }}>
         <Link href="/" className="more">← В каталог</Link>
      </div>

      {/* Используем кастомную сетку, чтобы обложка не была огромной */}
      <div className="novel-details-layout" style={{ 
        display: 'grid', 
        gridTemplateColumns: 'minmax(250px, 300px) 1fr', 
        gap: '48px',
        alignItems: 'start' 
      }}>
        
        {/* Левая колонка: фиксированная ширина для обложки */}
        <aside>
          <div className="novel-cover" style={{ width: '100%', height: 'auto', aspectRatio: '3/4', position: 'relative' }}>
            {coverUrl ? (
              <img 
                src={coverUrl} 
                alt={novel.title} 
                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--radius)' }} 
              />
            ) : (
              <div className="placeholder p1" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {novel.title}
              </div>
            )}
            <span className="rating-chip" style={{ top: '12px', right: '12px' }}>
              <span className="star">★</span>{novel.average_rating > 0 ? novel.average_rating.toFixed(1) : '—'}
            </span>
          </div>

          <div className="stat-card" style={{ marginTop: '20px', textAlign: 'center' }}>
            <div className="label">Всего просмотров</div>
            <div className="value">{novel.views || 0}</div>
          </div>
          
          <button className="btn btn-primary" style={{ width: '100%', marginTop: '16px' }}>
            Читать первую главу
          </button>
        </aside>

        {/* Правая колонка: гибкая ширина для контента */}
        <article>
          <h1 style={{ fontSize: '32px', marginBottom: '12px', fontFamily: 'var(--font-lora)' }}>{novel.title}</h1>
          
          <div className="novel-meta" style={{ marginBottom: '32px', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <span className="by" style={{ fontWeight: 600 }}>{novel.author}</span>
            <span style={{ color: 'var(--ink-mute)' }}>·</span>
            <span className="status-pill status-active" style={{ background: novel.is_completed ? '#E3EBD6' : 'var(--accent-wash)' }}>
              {novel.is_completed ? 'Завершена' : 'В процессе'}
            </span>
          </div>

          <div className="card" style={{ marginBottom: '40px' }}>
            <h3 style={{ marginBottom: '16px' }}>О чем эта история</h3>
            <p style={{ lineHeight: '1.7', color: 'var(--ink-soft)' }}>{novel.description}</p>
            <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid var(--border)', fontSize: '13px' }}>
              <strong style={{ color: 'var(--ink)' }}>Жанры:</strong> {genresList}
            </div>
          </div>

          <h3 style={{ marginBottom: '20px' }}>Список глав ({chapters?.length || 0})</h3>
          <div className="card" style={{ padding: 0 }}>
            <div className="chapters-list">
              {chapters?.map((chapter) => (
                <div key={chapter.id} className="reading-row" style={{ padding: '16px 24px', cursor: 'pointer' }}>
                  <div style={{ fontWeight: 600 }}>Глава {chapter.chapter_number}</div>
                  <div style={{ color: 'var(--ink-mute)', fontSize: '12px' }}>
                    {chapter.published_at ? new Date(chapter.published_at).toLocaleDateString('ru-RU') : ''}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {chapter.is_paid ? (
                      <span className="status-pill status-expired">10 монет</span>
                    ) : (
                      <span className="status-pill status-active">Бесплатно</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </article>
      </div>
    </main>
  );
}