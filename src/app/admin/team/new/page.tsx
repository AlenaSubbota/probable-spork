import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { fetchMyOwnedTeam } from '@/lib/team';
import TeamCreateForm from './TeamCreateForm';

export const metadata = { title: 'Создать команду · Админка — Chaptify' };

export default async function NewTeamPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_admin, translator_slug, translator_display_name, user_name, avatar_url')
    .eq('id', user.id)
    .maybeSingle();
  const p = profile as {
    role?: string;
    is_admin?: boolean;
    translator_slug?: string | null;
    translator_display_name?: string | null;
    user_name?: string | null;
    avatar_url?: string | null;
  } | null;
  const isTranslator =
    p?.is_admin === true || p?.role === 'translator' || p?.role === 'admin';
  if (!isTranslator) redirect('/translator/apply');

  const existing = await fetchMyOwnedTeam(supabase, user.id);
  if (existing) redirect(`/admin/team/${existing.id}/edit`);

  const suggestedSlug =
    p?.translator_slug ?? (p?.user_name?.toLowerCase().replace(/[^a-z0-9-]/g, '') || '');
  const suggestedName =
    p?.translator_display_name ?? p?.user_name ?? '';

  return (
    <main className="container admin-page" style={{ maxWidth: 720 }}>
      <div className="admin-breadcrumbs">
        <Link href="/admin">Админка</Link>
        <span>/</span>
        <span>Команда</span>
        <span>/</span>
        <span>Создать</span>
      </div>

      <header className="team-create-hero">
        <div className="team-create-hero-text">
          <span className="pm-hero-eyebrow">🪶 Команда</span>
          <h1 className="team-create-title">Соберём команду для перевода</h1>
          <p className="team-create-sub">
            Команда — это твоё «бренд-имя» под которым выходят переводы.
            Один человек или двадцать — формат тот же. Читатели видят
            <strong> «перевод команды N»</strong>, заходят на её страницу,
            смотрят участников и поддерживают одной кнопкой — деньги идут
            тебе как лидеру (внешние Boosty / Tribute / карта), участников
            делишь сам.
          </p>
        </div>
      </header>

      <TeamCreateForm
        suggestedSlug={suggestedSlug}
        suggestedName={suggestedName}
        suggestedAvatar={p?.avatar_url ?? null}
      />
    </main>
  );
}
