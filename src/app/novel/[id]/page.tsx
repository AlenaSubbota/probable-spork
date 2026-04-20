import { createClient } from '@/utils/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';

// Указываем Next.js, что параметры маршрута асинхронны (требование новых версий App Router)
interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function NovelPage({ params }: PageProps) {
  // Инициализируем серверный клиент Supabase
  const supabase = await createClient();
  
  // Дожидаемся параметров маршрута
  const resolvedParams = await params;

  // 1. Получаем данные новеллы из представления novels_view по firebase_id
  const { data: novel, error: novelError } = await supabase
    .from('novels_view')
    .select('*')
    .eq('firebase_id', resolvedParams.id)
    .single();

  if (novelError || !novel) {
    notFound(); // Отдаст страницу 404, если новелла не найдена
  }

  // 2. Получаем список глав для этой новеллы
  const { data: chapters } = await supabase
    .from('chapters')
    .select('id, chapter_number, is_paid, published_at, like_count')
    .eq('novel_id', novel.id)
    .order('chapter_number', { ascending: false });

  // Форматируем жанры из JSONB
  const genresList = Array.isArray(novel.genres) 
    ? novel.genres.join(', ') 
    : 'Жанры не указаны';

  return (
    <main className="container section">
      <Link href="/" className="more" style={{ marginBottom: '20px', display: 'inline-block' }}>
        ← Назад в каталог
      </Link>

      <div className="hero-grid">
        {/* Левая колонка: Обложка и статистика */}
        <div>
          <div className="novel-cover" style={{ width: '100%', height: 'auto', aspectRatio: '3/4', marginBottom: '16px' }}>
            {novel.cover_url ? (
              <img 
                src={novel.cover_url} 
                alt={novel.title} 
                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--radius)' }} 
              />
            ) : (
              <div className="placeholder p1">{novel.title}</div>
            )}
            
            <span className="rating-chip" style={{ top: '12px', right: '12px' }}>
              <span className="star">★</span>
              {novel.average_rating > 0 ? novel.average_rating.toFixed(1) : 'Новая'}
            </span>
          </div>
          
          <div className="card-grid-3" style={{ gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div className="stat-card" style={{ padding: '12px' }}>
              <div className="label">Просмотры</div>
              <div className="value" style={{ fontSize: '18px' }}>{novel.views || 0}</div>
            </div>
            <div className="stat-card" style={{ padding: '12px' }}>
              <div className="label">Главы</div>
              <div className="value" style={{ fontSize: '18px' }}>{chapters?.length || 0}</div>
            </div>
          </div>
        </div>

        {/* Правая колонка: Описание и список глав */}
        <div>
          <h1 style={{ marginBottom: '8px' }}>{novel.title}</h1>
          <div style={{ color: 'var(--ink-mute)', marginBottom: '24px', fontSize: '14px' }}>
            <span className="by">{novel.author || 'Неизвестный автор'}</span>
            <span style={{ margin: '0 8px' }}>·</span>
            <span>{novel.is_completed ? 'Завершена' : 'В процессе'}</span>
            <span style={{ margin: '0 8px' }}>·</span>
            <span>{genresList}</span>
          </div>

          <div className="card" style={{ marginBottom: '24px' }}>
            <h3>Описание</h3>
            <p style={{ lineHeight: 1.6, margin: 0, fontSize: '15px' }}>
              {novel.description || 'Описание пока не добавлено.'}
            </p>
          </div>

          <h3>Список глав</h3>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {chapters && chapters.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <tbody>
                  {chapters.map((chapter) => (
                    <tr key={chapter.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '16px', fontWeight: 500 }}>
                        Глава {chapter.chapter_number}
                      </td>
                      <td style={{ padding: '16px', color: 'var(--ink-mute)', textAlign: 'right' }}>
                        {chapter.like_count > 0 && <span style={{ marginRight: '16px' }}>♥ {chapter.like_count}</span>}
                        {chapter.is_paid ? (
                          <span className="status-pill status-expired">Платная</span>
                        ) : (
                          <span className="status-pill status-active">Бесплатная</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--ink-mute)' }}>
                Главы еще не загружены.
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}