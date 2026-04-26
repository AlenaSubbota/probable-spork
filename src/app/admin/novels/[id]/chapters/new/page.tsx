import { createClient } from '@/utils/supabase/server';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import ChapterForm from '@/components/admin/ChapterForm';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function NewChapterPage({ params }: PageProps) {
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

  // Подсказываем следующий номер главы
  const { data: lastCh } = await supabase
    .from('chapters')
    .select('chapter_number')
    .eq('novel_id', novel.id)
    .order('chapter_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  const suggested = (lastCh?.chapter_number ?? 0) + 1;

  // Глоссарий
  const { data: glossary } = await supabase
    .from('novel_glossaries')
    .select('term_original, term_translation, category')
    .eq('novel_id', novel.id);

  // Черновик: последний сохранённый для этой новеллы этим пользователем
  const { data: draft } = await supabase
    .from('chapter_drafts')
    .select('chapter_number, content, is_paid, price_coins, updated_at')
    .eq('user_id', user.id)
    .eq('novel_id', novel.id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <main className="container admin-page admin-page--wide">
      <div className="admin-breadcrumbs">
        <Link href="/admin">Админка</Link>
        <span>/</span>
        <Link href={`/admin/novels/${novel.firebase_id}/edit`}>{novel.title}</Link>
        <span>/</span>
        <span>Новая глава</span>
      </div>

      <header
        className="admin-head"
        style={{ alignItems: 'flex-start', marginBottom: 8 }}
      >
        <div>
          <h1>Новая глава · {novel.title}</h1>
          <p style={{ color: 'var(--ink-mute)', margin: '8px 0 0' }}>
            Черновик сохраняется автоматически каждые 2 секунды. Можно
            закрыть вкладку и вернуться позже.
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
            href={`/admin/novels/${novel.firebase_id}/chapters/bulk`}
            className="btn btn-ghost"
          >
            📚 Массовая загрузка
          </Link>
        </div>
      </header>

      <ChapterForm
        mode="create"
        novelId={novel.id}
        novelFirebaseId={novel.firebase_id}
        glossary={glossary ?? []}
        draft={draft ?? null}
        suggestedChapterNumber={suggested}
      />
    </main>
  );
}
