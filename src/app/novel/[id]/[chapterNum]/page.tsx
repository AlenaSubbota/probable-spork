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
  const num = parseInt(chapterNum, 10);

  const { data: novel } = await supabase
    .from('novels')
    .select('id, title, firebase_id')
    .eq('firebase_id', id)
    .single();

  if (!novel) notFound();

  const { data: chapter } = await supabase
    .from('chapters')
    .select('id, chapter_number, is_paid, content_path, published_at')
    .eq('novel_id', novel.id)
    .eq('chapter_number', num)
    .single();

  if (!chapter) notFound();

  // Загружаем текст из storage
  let finalContent: string = '';
  if (chapter.content_path) {
    const { data: fileData, error: storageError } = await supabase.storage
      .from('chapter_content')
      .download(chapter.content_path);

    if (!storageError && fileData) {
      finalContent = await fileData.text();
    } else {
      finalContent = `<p style="color:var(--rose)">Не удалось загрузить текст: ${storageError?.message ?? 'неизвестная ошибка'}.</p>`;
    }
  }

  if (!finalContent) {
    finalContent = '<p><em>Текст главы отсутствует.</em></p>';
  }

  // Соседние главы
  const [{ data: prevChapter }, { data: nextChapter }] = await Promise.all([
    supabase
      .from('chapters')
      .select('chapter_number')
      .eq('novel_id', novel.id)
      .eq('chapter_number', num - 1)
      .maybeSingle(),
    supabase
      .from('chapters')
      .select('chapter_number')
      .eq('novel_id', novel.id)
      .eq('chapter_number', num + 1)
      .maybeSingle(),
  ]);

  return (
    <div className="reader-page">
      <header className="reader-header">
        <div className="container reader-header-row">
          <Link href={`/novel/${id}`} className="reader-back">
            ← {novel.title}
          </Link>
          <div className="reader-chapter-num">Глава {chapter.chapter_number}</div>
          <div className="reader-header-spacer" />
        </div>
      </header>

      <main className="reader-main">
        <h1 className="reader-title">
          Глава {chapter.chapter_number}
        </h1>

        <ReaderContent
          content={finalContent}
          novelId={novel.id}
          chapterNumber={chapter.chapter_number}
        />

        <nav className="reader-nav">
          {prevChapter ? (
            <Link
              href={`/novel/${id}/${prevChapter.chapter_number}`}
              className="btn btn-ghost"
              style={{ flex: 1, textAlign: 'center' }}
            >
              ← Глава {prevChapter.chapter_number}
            </Link>
          ) : (
            <div style={{ flex: 1 }} />
          )}

          {nextChapter ? (
            <Link
              href={`/novel/${id}/${nextChapter.chapter_number}`}
              className="btn btn-primary"
              style={{ flex: 1, textAlign: 'center' }}
            >
              Глава {nextChapter.chapter_number} →
            </Link>
          ) : (
            <Link
              href={`/novel/${id}`}
              className="btn btn-ghost"
              style={{ flex: 1, textAlign: 'center' }}
            >
              К новелле
            </Link>
          )}
        </nav>

        <hr className="reader-divider" />

        <CommentsSection chapterId={String(chapter.id)} />
      </main>
    </div>
  );
}
