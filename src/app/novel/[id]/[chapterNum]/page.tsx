import { createClient } from '@/utils/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import ReaderContent from '@/components/ReaderContent';
import CommentsSection from '@/components/CommentsSection';

interface PageProps {
  params: Promise<{ id: string; chapterNum: string }>;
}

export default async function ChapterPage({ params }: PageProps) {
  const supabase = await createClient();
  const { id, chapterNum } = await params;
  const num = parseInt(chapterNum);

  // 1. Получаем данные новеллы и главы
  const { data: novel } = await supabase
    .from('novels')
    .select('id, title')
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

  // 2. ЛОГИКА ЗАГРУЗКИ ТЕКСТА
  let finalContent = chapter.content;

  // Если в базе текста нет, но есть путь к файлу — качаем из Storage
  if (!finalContent && chapter.content_path) {
    const { data: fileData, error: storageError } = await supabase.storage
      .from('chapter_content')
      .download(chapter.content_path);

    if (!storageError && fileData) {
      finalContent = await fileData.text();
    } else {
      finalContent = `<p style="color:red">Ошибка загрузки контента: ${storageError?.message}</p>`;
    }
  }

  // 3. Навигация (соседние главы)
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
    <div className="reader-page">
      <header className="site-header" style={{ position: 'sticky', top: 0, zIndex: 100 }}>
        <div className="container header-row" style={{ justifyContent: 'space-between' }}>
          <Link href={`/novel/${id}`} className="logo" style={{ fontSize: '15px' }}>
            ← {novel.title}
          </Link>
          <div style={{ fontWeight: 600 }}>Глава {chapter.chapter_number}</div>
          <div style={{ width: '40px' }}></div> {/* Заглушка для симметрии */}
        </div>
      </header>

      <main className="container" style={{ maxWidth: '800px', padding: '40px 20px' }}>
        <h1 style={{ fontFamily: 'var(--font-lora)', textAlign: 'center', marginBottom: '48px' }}>
          {chapter.title || `Глава ${chapter.chapter_number}`}
        </h1>

        {/* Вывод текста */}
        <ReaderContent content={finalContent || 'Текст главы отсутствует.'} />

        {/* Кнопки переключения */}
        <nav style={{ display: 'flex', justifyContent: 'space-between', marginTop: '60px', gap: '20px' }}>
          {prevChapter ? (
            <Link href={`/novel/${id}/${prevChapter.chapter_number}`} className="btn btn-ghost" style={{ flex: 1, textAlign: 'center' }}>
              ← Назад
            </Link>
          ) : <div style={{ flex: 1 }} />}

          {nextChapter ? (
            <Link href={`/novel/${id}/${nextChapter.chapter_number}`} className="btn btn-primary" style={{ flex: 1, textAlign: 'center' }}>
              Вперед →
            </Link>
          ) : (
            <Link href={`/novel/${id}`} className="btn btn-ghost" style={{ flex: 1, textAlign: 'center' }}>
              К новелле
            </Link>
          )}
        </nav>

        {/* СЕКЦИЯ КОММЕНТАРИЕВ */}
        <hr style={{ margin: '60px 0 40px', border: 0, borderTop: '1px solid var(--border)' }} />
        <CommentsSection chapterId={chapter.id} />
      </main>
    </div>
  );
}