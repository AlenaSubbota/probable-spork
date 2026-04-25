import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { fetchMyOwnedTeam } from '@/lib/team';

// Лендинг управления командой. Если у пользователя уже есть команда —
// редирект на её редактор. Если нет — редирект на форму создания.
// Это даёт одну стабильную ссылку «Моя команда» из UserMenu / админки.
export default async function AdminTeamLanding() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_admin')
    .eq('id', user.id)
    .maybeSingle();
  const p = profile as { role?: string; is_admin?: boolean } | null;
  const isTranslator =
    p?.is_admin === true || p?.role === 'translator' || p?.role === 'admin';
  if (!isTranslator) redirect('/translator/apply');

  const team = await fetchMyOwnedTeam(supabase, user.id);
  if (team) redirect(`/admin/team/${team.id}/edit`);
  redirect('/admin/team/new');
}
