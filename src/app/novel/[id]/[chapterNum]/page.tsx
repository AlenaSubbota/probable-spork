import { createClient } from '@/utils/supabase/server';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import ReaderContent from '@/components/ReaderContent'; 

interface PageProps {
  params: Promise<{ id: string; chapterNum: string }>;
}

export default async function ChapterPage({ params }: PageProps) {
  const supabase = await createClient();
  const { id, chapterNum } = await params;
  const num = parseInt(chapterNum);

  // 1. Получаем новеллу и текущую главу одним запросом или через JOIN
  const { data: novel } = await supabase
    .from('novels')
    .select('id, title, firebase_id')
    .eq('firebase_id', id)
    .single();

  if (!novel) notFound();

  const { data: chapter } = await supabase
    .from('chapters')
    .select('*')
    .eq('novel_id', novel.id)
    .eq('chapter_number', num)
    .single();

  if (!chapter) notFound();

  // 2. Проверка доступа (платная/бесплатная)
  // В будущем здесь будет вызов RPC can_read_chapter
  if (chapter.is_paid) {
    // Если глава платная, а логики покупки еще нет — временно редиректим на новеллу
    // redirect(`/novel/${id}?error=paid`); 
  }

  // 3. Ищем ID следующей и предыдущей глав для навигации
  const { data: prevChapter } = await supabase
    .from('chapters')
    .select('chapter_number')
    .eq('novel_id', novel.id)
    .eq('chapter_number', num - 1)
    .maybeSingle();

  const { data: nextChapter } = await supabase
    .from('chapters')
    .select('chapter_number')
    .eq('novel_id', novel.id)
    .eq('chapter_number', num + 1)
    .maybeSingle();

  return (
    <div className="reader-page" style={{ background: 'var(--surface)', minHeight: '100vh' }}>
      {/* Мини-шапка читалки */}
      <header className="site-header" style={{ position: 'sticky', top: 0 }}>
        <div className="container header-row" style={{ justifyContent: 'space-between' }}>
          <Link href={`/novel/${id}`} className="logo" style={{ fontSize: '16px' }}>
            ← {novel.title}
          </Link>
          <div style={{ fontWeight: 600 }}>Глава {chapter.chapter_number}</div>
          <div className="header-actions">
             {/* Кнопка настроек будет внутри ReaderContent */}
          </div>
        </div>
      </header>

      <main className="container" style={{ maxWidth: '800px', padding: '40px 24px' }}>
        <h1 style={{ fontFamily: 'var(--font-serif)', textAlign: 'center', marginBottom: '48px' }}>
          {chapter.title || `Глава ${chapter.chapter_number}`}
        </h1>

        {/* Клиентский компонент с текстом и настройками */}
        <ReaderContent 
          content={chapter.content} 
        />

        {/* Навигация между главами */}
        <nav style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          marginTop: '64px', 
          paddingTop: '32px', 
          borderTop: '1px solid var(--border)' 
        }}>
          {prevChapter ? (
            <Link href={`/novel/${id}/${prevChapter.chapter_number}`} className="btn btn-ghost">
              ← Пред. глава
            </Link>
          ) : <div />}

          {nextChapter ? (
            <Link href={`/novel/${id}/${nextChapter.chapter_number}`} className="btn btn-primary">
              След. глава →
            </Link>
          ) : (
            <Link href={`/novel/${id}`} className="btn btn-ghost">
              К описанию
            </Link>
          )}
        </nav>
      </main>
    </div>
  );
}