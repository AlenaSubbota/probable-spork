import { createClient } from '@/utils/supabase/server';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import NovelForm from '@/components/admin/NovelForm';
import GlossaryPanel from '@/components/admin/GlossaryPanel';
import type {
  AgeRating,
  Country,
  TranslationStatus,
} from '@/lib/admin';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditNovelPage({ params }: PageProps) {
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
    .select('*')
    .eq('firebase_id', id)
    .single();

  if (!novel) notFound();

  const isOwner = novel.translator_id === user.id || isAdmin;
  if (!isOwner) {
    redirect('/admin');
  }

  const { data: glossary } = await supabase
    .from('novel_glossaries')
    .select('*')
    .eq('novel_id', novel.id)
    .order('category', { ascending: true, nullsFirst: false })
    .order('term_original', { ascending: true });

  return (
    <main className="container admin-page">
      <div className="admin-breadcrumbs">
        <Link href="/admin">Админка</Link>
        <span>/</span>
        <Link href={`/novel/${novel.firebase_id}`}>{novel.title}</Link>
        <span>/</span>
        <span>Редактирование</span>
      </div>

      <header
        className="admin-head"
        style={{ alignItems: 'flex-start', marginBottom: 24 }}
      >
        <div>
          <h1>{novel.title}</h1>
          <p className="admin-head-sub">Параметры, жанры, описание, глоссарий.</p>
        </div>
        <Link
          href={`/admin/novels/${novel.firebase_id}/chapters/new`}
          className="btn btn-primary"
        >
          + Добавить главу
        </Link>
      </header>

      <NovelForm
        mode="edit"
        initial={{
          id: novel.id,
          firebase_id: novel.firebase_id,
          title: novel.title,
          title_original: novel.title_original,
          title_en: novel.title_en,
          author: novel.author,
          country: novel.country as Country | null,
          age_rating: novel.age_rating as AgeRating | null,
          translation_status: (novel.translation_status as TranslationStatus) ?? 'ongoing',
          is_completed: !!novel.is_completed,
          release_year: novel.release_year,
          description: novel.description ?? '',
          cover_url: novel.cover_url,
          genres: Array.isArray(novel.genres) ? (novel.genres as string[]) : [],
        }}
      />

      <div style={{ marginTop: 48 }}>
        <GlossaryPanel novelId={novel.id} initial={glossary ?? []} />
      </div>
    </main>
  );
}
