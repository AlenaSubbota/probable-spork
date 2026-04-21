import { createClient } from '@/utils/supabase/server';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import ChapterForm from '@/components/admin/ChapterForm';

interface PageProps {
  params: Promise<{ id: string; chapterNum: string }>;
}

export default async function EditChapterPage({ params }: PageProps) {
  const { id, chapterNum } = await params;
  const num = parseInt(chapterNum, 10);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  const p = profile as { role?: string; is_admin?: boolean } | null;
  const isAdmin = p?.is_admin === true || p?.role === 'admin';

  const { data: novel } = await supabase
    .from('novels')
    .select('id, firebase_id, title, translator_id')
    .eq('firebase_id', id)
    .single();

  if (!novel) notFound();

  const isOwner = novel.translator_id === user.id || isAdmin;
  if (!isOwner) redirect('/admin');

  const { data: chapter } = await supabase
    .from('chapters')
    .select('chapter_number, is_paid, content_path, price_coins')
    .eq('novel_id', novel.id)
    .eq('chapter_number', num)
    .single();

  if (!chapter) notFound();

  let content = '';
  if (chapter.content_path) {
    const { data: fileData } = await supabase.storage
      .from('chapter_content')
      .download(chapter.content_path);
    if (fileData) content = await fileData.text();
  }

  const { data: glossary } = await supabase
    .from('novel_glossaries')
    .select('term_original, term_translation, category')
    .eq('novel_id', novel.id);

  return (
    <main className="container admin-page admin-page--wide">
      <div className="admin-breadcrumbs">
        <Link href="/admin">Админка</Link>
        <span>/</span>
        <Link href={`/admin/novels/${novel.firebase_id}/edit`}>{novel.title}</Link>
        <span>/</span>
        <span>Глава {chapter.chapter_number}</span>
      </div>

      <h1 style={{ marginBottom: 24 }}>
        Редактирование главы {chapter.chapter_number} · {novel.title}
      </h1>

      <ChapterForm
        mode="edit"
        novelId={novel.id}
        novelFirebaseId={novel.firebase_id}
        glossary={glossary ?? []}
        initial={{
          chapter_number: chapter.chapter_number,
          content,
          is_paid: !!chapter.is_paid,
          price_coins: chapter.price_coins ?? 10,
        }}
      />
    </main>
  );
}
