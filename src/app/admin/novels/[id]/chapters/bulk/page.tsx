import { createClient } from '@/utils/supabase/server';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import BulkChapterUpload from './BulkChapterUpload';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function BulkChaptersPage({ params }: PageProps) {
  const { id } = await params;
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

  // Последняя опубликованная глава — для подсказки номера
  const { data: lastCh } = await supabase
    .from('chapters')
    .select('chapter_number')
    .eq('novel_id', novel.id)
    .order('chapter_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  const suggestedStart = (lastCh?.chapter_number ?? 0) + 1;

  return (
    <main className="container admin-page admin-page--wide">
      <div className="admin-breadcrumbs">
        <Link href="/admin">Админка</Link>
        <span>/</span>
        <Link href={`/admin/novels/${novel.firebase_id}/edit`}>{novel.title}</Link>
        <span>/</span>
        <span>Массовая загрузка</span>
      </div>

      <header className="admin-head" style={{ marginBottom: 14 }}>
        <div>
          <h1>Массовая загрузка глав · {novel.title}</h1>
          <p className="admin-head-sub">
            Вставь текст со всеми главами сразу — разберу и выложу. Помечай
            начало каждой главы заголовком «Глава N».
          </p>
        </div>
        <Link
          href={`/admin/novels/${novel.firebase_id}/chapters/new`}
          className="btn btn-ghost"
        >
          ← Одна глава
        </Link>
      </header>

      <BulkChapterUpload
        novelId={novel.id}
        novelFirebaseId={novel.firebase_id}
        suggestedStart={suggestedStart}
      />
    </main>
  );
}
