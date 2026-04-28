import { createClient } from '@/utils/supabase/server';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import NovelForm from '@/components/admin/NovelForm';
import GlossaryPanel from '@/components/admin/GlossaryPanel';
import CreditsEditor from '@/components/admin/CreditsEditor';
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

  // Chaptify-only метаданные (мигр. 065). Если строки ещё нет —
  // считаем флаг false (новелла свежая, никто не помечал).
  const { data: chaptifyMeta } = await supabase
    .from('novel_chaptify_meta')
    .select('original_completed')
    .eq('novel_id', novel.id)
    .maybeSingle();
  const originalCompleted = !!(chaptifyMeta as { original_completed?: boolean } | null)
    ?.original_completed;

  const { data: glossary } = await supabase
    .from('novel_glossaries')
    .select('*')
    .eq('novel_id', novel.id)
    .order('category', { ascending: true, nullsFirst: false })
    .order('term_original', { ascending: true });

  // Команды юзера: где он лидер (owner). Админ может прицепить новеллу
  // в любую свою. Если новелла уже в чужой команде — показываем её отдельно.
  const { data: ownedRaw } = await supabase
    .from('team_view')
    .select('id, slug, name, avatar_url, member_count')
    .eq('owner_id', user.id)
    .eq('is_archived', false)
    .order('created_at', { ascending: true });
  const availableTeams: Array<{
    id: number; slug: string; name: string;
    avatar_url: string | null; member_count: number;
  }> = (ownedRaw ?? []).map((t) => {
    const r = t as {
      id: number; slug: string; name: string;
      avatar_url: string | null; member_count: number | null;
    };
    return {
      id: r.id, slug: r.slug, name: r.name,
      avatar_url: r.avatar_url, member_count: r.member_count ?? 1,
    };
  });
  // Если новелла прикреплена к команде, которой юзер не владеет, всё
  // равно показываем её в picker'е — иначе UI потерял бы выбор.
  const novelTeamId = (novel as { team_id?: number | null }).team_id ?? null;
  if (novelTeamId && !availableTeams.some((t) => t.id === novelTeamId)) {
    const { data: foreignTeam } = await supabase
      .from('team_view')
      .select('id, slug, name, avatar_url, member_count')
      .eq('id', novelTeamId)
      .maybeSingle();
    if (foreignTeam) {
      const r = foreignTeam as {
        id: number; slug: string; name: string;
        avatar_url: string | null; member_count: number | null;
      };
      availableTeams.unshift({
        id: r.id, slug: r.slug, name: r.name,
        avatar_url: r.avatar_url, member_count: r.member_count ?? 1,
      });
    }
  }

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
        availableTeams={availableTeams}
        initial={{
          id: novel.id,
          firebase_id: novel.firebase_id,
          team_id: novelTeamId,
          title: novel.title,
          title_original: novel.title_original,
          title_en: novel.title_en,
          author: novel.author,
          author_original: novel.author_original ?? null,
          author_en: novel.author_en ?? null,
          country: novel.country as Country | null,
          age_rating: novel.age_rating as AgeRating | null,
          translation_status: (novel.translation_status as TranslationStatus) ?? 'ongoing',
          original_completed: originalCompleted,
          release_year: novel.release_year,
          descriptionHtml: novel.description ?? '',
          description: '',
          cover_url: novel.cover_url,
          covers: Array.isArray(novel.covers)
            ? (novel.covers as string[]).filter((v) => typeof v === 'string')
            : [],
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
        <CreditsEditor
          novelId={novel.id}
          novelTitle={novel.title}
          translatorId={novel.translator_id ?? null}
        />
      </div>

      <div style={{ marginTop: 48 }}>
        <GlossaryPanel novelId={novel.id} initial={glossary ?? []} />
      </div>
    </main>
  );
}
