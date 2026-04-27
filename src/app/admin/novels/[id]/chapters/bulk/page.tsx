import { createClient } from '@/utils/supabase/server';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import BulkChapterUpload from './BulkChapterUpload';
import BulkUploadHelp from '@/components/admin/BulkUploadHelp';
import ChapterListPanel from '@/components/admin/ChapterListPanel';

interface PageProps {
  params: Promise<{ id: string }>;
}

const BULK_DRAFT_CHAPTER_NUMBER = 0;

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

  // Все главы — для подсказки «открыть следующие N бесплатных» И для
  // ChapterListPanel под формой.
  const { data: allChaps } = await supabase
    .from('chapters')
    .select('chapter_number, is_paid, content_path, published_at')
    .eq('novel_id', novel.id)
    .order('chapter_number', { ascending: true });
  const existing = (allChaps ?? []) as Array<{
    chapter_number: number;
    is_paid: boolean;
    content_path: string | null;
    published_at: string | null;
  }>;

  // Bulk-черновик: одна запись в chapter_drafts на (user, novel) с
  // зарезервированным chapter_number = 0. Если есть текст — предложим
  // восстановить через DraftBanner внутри формы.
  const { data: bulkDraftRow } = await supabase
    .from('chapter_drafts')
    .select('content, updated_at')
    .eq('user_id', user.id)
    .eq('novel_id', novel.id)
    .eq('chapter_number', BULK_DRAFT_CHAPTER_NUMBER)
    .maybeSingle();
  const bulkDraft =
    bulkDraftRow && (bulkDraftRow.content?.length ?? 0) > 0
      ? {
          content: bulkDraftRow.content as string,
          updated_at: bulkDraftRow.updated_at as string,
        }
      : null;

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
            начало каждой главы заголовком «Глава N». Можно одновременно
            открыть несколько уже загруженных глав бесплатно — подписчикам
            прилетит ОДНО уведомление обо всём.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link
            href={`/admin/novels/${novel.firebase_id}/edit`}
            className="btn btn-ghost"
          >
            ← К новелле
          </Link>
          <Link
            href={`/admin/novels/${novel.firebase_id}/chapters/new`}
            className="btn btn-ghost"
          >
            ＋ Одна глава
          </Link>
        </div>
      </header>

      {/* Расширенная справка — свернута по умолчанию, разворачивается
          одним кликом. Полное «как этим пользоваться, что увидят
          подписчики, как решать частые проблемы». */}
      <BulkUploadHelp />

      <BulkChapterUpload
        novelId={novel.id}
        novelFirebaseId={novel.firebase_id}
        suggestedStart={suggestedStart}
        existingChapters={existing.map((c) => ({
          chapter_number: c.chapter_number,
          is_paid: c.is_paid,
        }))}
        draft={bulkDraft}
      />

      <ChapterListPanel
        novelId={novel.id}
        novelFirebaseId={novel.firebase_id}
        initial={existing.map((c) => ({
          chapter_number: c.chapter_number,
          is_paid: c.is_paid,
          content_path: c.content_path,
          published_at: c.published_at,
        }))}
      />
    </main>
  );
}
