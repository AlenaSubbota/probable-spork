import { createClient } from '@/utils/supabase/server';
import HeroBanner from '@/components/HeroBanner';
import GenreChips from '@/components/GenreChips';
import NovelCard from '@/components/NovelCard';
import Link from 'next/link';

export default async function HomePage() {
  const supabase = await createClient();

  // 1. Получаем "Популярное" (сортировка по среднему рейтингу)
  const { data: popularNovels } = await supabase
    .from('novels_view')
    .select('*')
    .order('average_rating', { ascending: false })
    .limit(6);

  // 2. Получаем "Новые главы" (сортировка по дате последней главы)
  const { data: recentNovels } = await supabase
    .from('novels_view')
    .select('*')
    .order('latest_chapter_published_at', { ascending: false })
    .limit(6);

  // Функция для формирования URL обложки (аналогично странице новеллы)
  const getCoverUrl = (path: string | null) => {
    if (!path) return null;
    if (path.startsWith('http')) return path;
    return `https://tene.fun/storage/v1/object/public/covers/${path}`;
  };

  return (
    <main>
      <HeroBanner />
      <GenreChips />

      {/* Секция: Популярное */}
      <section className="container section">
        <div className="section-head">
          <h2>Популярное</h2>
          <Link href="/catalog" className="more">Смотреть все →</Link>
        </div>

        <div className="novel-grid">
          {popularNovels?.map((novel, index) => (
            <NovelCard 
              key={novel.id}
              id={novel.firebase_id} 
              title={novel.title} 
              translator={novel.author || 'Автор'} 
              metaInfo={`${novel.rating_count || 0} оценок`} 
              rating={novel.average_rating ? novel.average_rating.toFixed(1) : '—'}
              // Передаем пропсы для отображения обложки или плейсхолдера
              coverUrl={getCoverUrl(novel.cover_url)}
              placeholderClass={`p${(index % 8) + 1}`}
              placeholderText={novel.title.substring(0, 10) + '...'}
              flagText={novel.average_rating > 4.8 ? "HOT" : undefined}
            />
          ))}
        </div>
      </section>

      {/* Секция: Новые главы */}
      <section className="container section">
        <div className="section-head">
          <h2>Новые главы</h2>
          <Link href="/feed" className="more">Вся лента →</Link>
        </div>

        <div className="novel-grid">
          {recentNovels?.map((novel, index) => {
             // Считаем, сколько времени прошло (упрощенно)
             const date = novel.latest_chapter_published_at 
                ? new Date(novel.latest_chapter_published_at).toLocaleDateString('ru-RU')
                : 'Недавно';

             return (
              <NovelCard 
                key={novel.id}
                id={novel.firebase_id} 
                title={novel.title} 
                translator={novel.author || 'Автор'} 
                metaInfo={date} 
                rating={novel.average_rating ? novel.average_rating.toFixed(1) : '—'}
                coverUrl={getCoverUrl(novel.cover_url)}
                placeholderClass={`p${(index % 8) + 1}`}
                placeholderText={novel.title.substring(0, 10) + '...'}
              />
            );
          })}
        </div>
      </section>
    </main>
  );
}