import Link from 'next/link'; // <--- Важно: добавить этот импорт
import { createClient } from '@/utils/supabase/server';
import { NovelCard } from '@/components/NovelCard';

export default async function HomePage() {
  const supabase = await createClient();

  // Запрос популярных новелл с джойном профиля переводчика
  const { data: popularNovels } = await supabase
    .from('novels')
    .select('*, profiles(username)')
    .order('rating', { ascending: false })
    .limit(6);

  return (
    <main className="container py-8">
      {/* Hero Banner */}
      <section className="hero-grid grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
        <div className="md:col-span-2 p-7 rounded-[var(--radius)] bg-gradient-to-br from-[#EFE1CE] to-[#D9BFA6] flex flex-col justify-end min-h-[220px]">
          <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--accent-hover)] mb-2">
            Новое на Chaptify
          </span>
          <h1 className="text-3xl font-serif mb-2">Два переводчика — одна платформа</h1>
          <p className="text-[var(--ink-soft)] max-w-md mb-4">
            Прогресс чтения синхронизируется с приложением в Telegram.
          </p>
          <div className="flex gap-3">
            <Link 
              href="/catalog" 
              className="px-5 py-2 bg-[var(--accent)] text-white rounded-lg font-bold"
            >
              Открыть каталог
            </Link>
          </div>
        </div>
        
        <div className="flex flex-col gap-5">
           <div className="p-5 rounded-[var(--radius)] bg-[var(--surface)] border border-[var(--border)]">
              <span className="text-[10px] uppercase font-bold text-[var(--accent)] px-2 py-0.5 bg-[var(--accent-wash)] rounded">Алёна</span>
              <h3 className="text-lg font-serif mt-2">42 новеллы</h3>
           </div>
           <div className="p-5 rounded-[var(--radius)] bg-[var(--surface)] border border-[var(--border)]">
              <span className="text-[10px] uppercase font-bold text-[#4C6A34] px-2 py-0.5 bg-[#E3EBD6] rounded">Иван</span>
              <h3 className="text-lg font-serif mt-2">17 новелл</h3>
           </div>
        </div>
      </section>

      {/* Сетка популярных новелл */}
      <section className="mb-10">
        <div className="flex justify-between items-baseline mb-4">
          <h2 className="text-2xl font-serif">Популярное</h2>
          <Link href="/catalog" className="text-[var(--accent)] font-semibold text-sm">
            Смотреть все →
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-5">
          {popularNovels?.map((novel: any) => (
            <NovelCard 
              key={novel.id}
              id={novel.id}
              title={novel.title}
              coverUrl={novel.image_url}
              rating={novel.rating || 0}
              chaptersCount={novel.chapters_count || 0}
              translatorName={novel.profiles?.username || 'Алёна'}
            />
          ))}
        </div>
      </section>
    </main>
  );
}