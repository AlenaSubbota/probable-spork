import { createClient } from '@/utils/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function NovelPage({ params }: PageProps) {
  const supabase = await createClient();
  const resolvedParams = await params;

  // Получаем данные из вьюхи (там уже есть рейтинги и просмотры)
  const { data: novel, error: novelError } = await supabase
    .from('novels_view')
    .select('*')
    .eq('firebase_id', resolvedParams.id)
    .single();

  if (novelError || !novel) notFound();

  // Список глав
  const { data: chapters } = await supabase
    .from('chapters')
    .select('id, chapter_number, is_paid, published_at, like_count')
    .eq('novel_id', novel.id)
    .order('chapter_number', { ascending: false });

  // Универсальная функция для обложек
  const getCoverUrl = (path: string | null) => {
    if (!path) return null;
    if (path.startsWith('http')) return path;
    // Конкатенируем путь с публичным URL бакета 'covers'
    // Обрабатывает и 'covers/11.webp', и '063aa...png'
    return `https://tene.fun/storage/v1/object/public/covers/${path}`;
  };

  const coverUrl = getCoverUrl(novel.cover_url);
  const genresList = Array.isArray(novel.genres) ? novel.genres.join(', ') : 'Жанры не указаны';

  return (
    <main className="container section">
      <div className="section-head" style={{ marginBottom: '32px' }}>
         <Link href="/" className="more">← В каталог</Link>
      </div>

      <div className="novel-details-layout" style={{ 
        display: 'grid', 
        gridTemplateColumns: 'minmax(250px, 300px) 1fr', 
        gap: '48px',
        alignItems: 'start' 
      }}>
        
        {/* Левая колонка */}
        <aside>
          <div className="novel-cover" style={{ width: '100%', aspectRatio: '3/4', position: 'relative' }}>
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

        {/* Правая колонка */}
        <article>
          <h1 style={{ fontSize: '32px', marginBottom: '12px', fontFamily: 'var(--font-lora)' }}>{novel.title}</h1>
          
          <div className="novel-meta" style={{ marginBottom: '32px', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="by" style={{ fontWeight: 600 }}>{novel.author}</span>
            <span style={{ color: 'var(--border-strong)' }}>·</span>
            <span className="status-pill status-active">
              {novel.is_completed ? 'Завершена' : 'В процессе'}
            </span>
          </div>

          <div className="card" style={{ marginBottom: '40px' }}>
            <h3 style={{ marginBottom: '16px' }}>Описание</h3>
            {/* Рендерим HTML из базы */}
            <div 
              className="novel-description-content"
              style={{ lineHeight: '1.7', color: 'var(--ink-soft)' }}
              dangerouslySetInnerHTML={{ __html: novel.description || 'Описание отсутствует.' }}
            />
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