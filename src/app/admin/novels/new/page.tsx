import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import NovelForm from '@/components/admin/NovelForm';

export default async function NewNovelPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_admin, user_name, translator_display_name')
    .eq('id', user.id)
    .maybeSingle();
  const p = profile as {
    role?: string;
    is_admin?: boolean;
    user_name?: string | null;
    translator_display_name?: string | null;
  } | null;
  const isAdmin = p?.is_admin === true || p?.role === 'admin';
  const isTranslator = isAdmin || p?.role === 'translator';
  if (!isTranslator) redirect('/translator/apply');
  const currentUserName = p?.translator_display_name ?? p?.user_name ?? null;

  // Команды, в которые юзер может прицепить новеллу: где он лидер
  // (owner_id = user.id). Если ноль — форма покажет CTA «Создай команду».
  const { data: teamsRaw } = await supabase
    .from('team_view')
    .select('id, slug, name, avatar_url, member_count')
    .eq('owner_id', user.id)
    .eq('is_archived', false)
    .order('created_at', { ascending: true });
  const availableTeams = (teamsRaw ?? []).map((t) => {
    const r = t as {
      id: number;
      slug: string;
      name: string;
      avatar_url: string | null;
      member_count: number | null;
    };
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      avatar_url: r.avatar_url,
      member_count: r.member_count ?? 1,
    };
  });
  const defaultTeamId = availableTeams[0]?.id ?? null;

  return (
    <main className="container admin-page">
      <div className="admin-breadcrumbs">
        <Link href="/admin">Админка</Link>
        <span>/</span>
        <span>Новая новелла</span>
      </div>

      <h1>Новая новелла</h1>
      <p style={{ color: 'var(--ink-mute)', marginBottom: 24 }}>
        {isAdmin
          ? 'Заполни карточку — новелла сразу станет опубликованной.'
          : 'Заполни карточку и сохрани как черновик. Когда всё будет готово — жми «Отправить на модерацию» на странице новеллы; админ проверит и опубликует.'}
      </p>

      <NovelForm
        mode="create"
        isAdmin={isAdmin}
        currentUserId={user.id}
        currentUserName={currentUserName}
        availableTeams={availableTeams}
        initial={{
          // Преселект себя — если админ/переводчик добавляет свою работу
          translator: {
            translator_id: user.id,
            external_name: null,
            external_url: null,
            external_consent: false,
          },
          team_id: defaultTeamId,
        }}
      />
    </main>
  );
}
