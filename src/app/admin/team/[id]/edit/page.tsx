import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { fetchTeamMembers, type TeamRow } from '@/lib/team';
import TeamSettingsForm from './TeamSettingsForm';
import TeamMembersEditor from './TeamMembersEditor';
import TeamNovelsLinker from './TeamNovelsLinker';

interface PageProps {
  params: Promise<{ id: string }>;
}

export const metadata = { title: 'Команда · настройки — Chaptify' };

export default async function EditTeamPage({ params }: PageProps) {
  const { id } = await params;
  const teamId = parseInt(id, 10);
  if (!Number.isFinite(teamId)) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_admin')
    .eq('id', user.id)
    .maybeSingle();
  const p = profile as { role?: string; is_admin?: boolean } | null;
  const isAdmin = p?.is_admin === true || p?.role === 'admin';

  const { data: teamRaw } = await supabase
    .from('team_view')
    .select('*')
    .eq('id', teamId)
    .maybeSingle();
  const team = (teamRaw ?? null) as TeamRow | null;
  if (!team) notFound();

  if (team.owner_id !== user.id && !isAdmin) {
    // не лидер и не админ — на публичную страницу
    redirect(`/team/${team.slug}`);
  }

  const [members, myNovelsRes, teamNovelsRes] = await Promise.all([
    fetchTeamMembers(supabase, team.id),
    // Все новеллы текущего юзера (он их создавал — может прицепить к команде)
    supabase
      .from('novels')
      .select('id, title, firebase_id, team_id')
      .eq('translator_id', user.id)
      .order('title', { ascending: true }),
    // Уже прикреплённые к команде новеллы (включая чужие, если админ цепляет)
    supabase
      .from('novels')
      .select('id, title, firebase_id, translator_id')
      .eq('team_id', team.id)
      .order('title', { ascending: true }),
  ]);

  const myNovels = (myNovelsRes.data ?? []) as Array<{
    id: number;
    title: string;
    firebase_id: string;
    team_id: number | null;
  }>;
  const teamNovels = (teamNovelsRes.data ?? []) as Array<{
    id: number;
    title: string;
    firebase_id: string;
    translator_id: string | null;
  }>;

  return (
    <main className="container admin-page" style={{ maxWidth: 760 }}>
      <div className="admin-breadcrumbs">
        <Link href="/admin">Админка</Link>
        <span>/</span>
        <span>Команда</span>
      </div>

      <header className="team-edit-hero">
        <div className="team-edit-hero-text">
          <span className="pm-hero-eyebrow">🪶 Управление командой</span>
          <h1 className="team-edit-title">{team.name}</h1>
          <p className="team-edit-sub">
            Это страница для тебя — лидера. Читатели команду видят на{' '}
            <Link href={`/team/${team.slug}`} className="team-edit-public-link">
              /team/{team.slug} ↗
            </Link>
            . Способы оплаты команды настраиваешь у себя в{' '}
            <Link href="/admin/payment-methods">«Способы оплаты»</Link> — на
            странице команды читатели видят твои подключённые методы как
            «куда донатить команде».
          </p>
        </div>
      </header>

      <TeamSettingsForm
        teamId={team.id}
        initial={{
          slug: team.slug,
          name: team.name,
          description: team.description ?? '',
          avatar_url: team.avatar_url ?? '',
          banner_url: team.banner_url ?? '',
          accepts_coins_for_chapters: team.accepts_coins_for_chapters,
        }}
      />

      <TeamMembersEditor
        teamId={team.id}
        leaderUserId={team.owner_id}
        initialMembers={members}
      />

      <TeamNovelsLinker
        teamId={team.id}
        myNovels={myNovels}
        teamNovels={teamNovels}
        currentUserId={user.id}
      />
    </main>
  );
}
