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

  const p = profile as {
    role?: string;
    is_admin?: boolean;
    user_name?: string | null;
    translator_display_name?: string | null;
  } | null;
  const isAdmin = p?.is_admin === true || p?.role === 'admin';
  const currentUserName = p?.translator_display_name ?? p?.user_name ?? null;

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
        <div style={{ display: 'flex', gap: 8 }}>
          <Link
            href={`/admin/novels/${novel.firebase_id}/chapters/bulk`}
            className="btn btn-ghost"
          >
            📚 Массовая загрузка
          </Link>
          <Link
            href={`/admin/novels/${novel.firebase_id}/chapters/new`}
            className="btn btn-primary"
          >
            + Одна глава
          </Link>
        </div>
      </header>

      <NovelForm
        mode="edit"
        isAdmin={isAdmin}
        currentUserId={user.id}
        currentUserName={currentUserName}
        initial={{
          id: novel.id,
          firebase_id: novel.firebase_id,
          title: novel.title,
          title_original: novel.title_original,
          title_en: novel.title_en,
          author: novel.author,
          author_original: novel.author_original ?? null,
          author_en: novel.author_en ?? null,
          country: novel.country as Country | null,
          age_rating: novel.age_rating as AgeRating | null,
          translation_status: (novel.translation_status as TranslationStatus) ?? 'ongoing',
          is_completed: !!novel.is_completed,
          release_year: novel.release_year,
          descriptionHtml: novel.description ?? '',
          description: '',
          cover_url: novel.cover_url,
          genres: Array.isArray(novel.genres) ? (novel.genres as string[]) : [],
          external_links: Array.isArray(novel.external_links)
            ? (novel.external_links as Array<{ label: string; url: string }>).filter(
                (l) => l && typeof l.url === 'string'
              )
            : [],
          epub_path: novel.epub_path ?? null,
          translator: {
            translator_id: novel.translator_id ?? null,
            external_name: novel.external_translator_name ?? null,
            external_url: novel.external_translator_url ?? null,
            external_consent: !!novel.external_translator_name,
          },
        }}
      />

      <div style={{ marginTop: 48 }}>
        <GlossaryPanel novelId={novel.id} initial={glossary ?? []} />
      </div>
    </main>
  );
}
