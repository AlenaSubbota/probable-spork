import type { SupabaseClient } from '@supabase/supabase-js';

// Роль в команде. lead — лидер, всегда один. Остальные — добровольно.
// Подбираются под жанры контента (translator/editor/proofreader/...) +
// ролевые специальности (illustrator/typesetter), чтобы переводчик
// мог честно сказать «над этой главой работали Маша, Аня и Лиля».
export type TeamRole =
  | 'lead'
  | 'translator'
  | 'co_translator'
  | 'editor'
  | 'proofreader'
  | 'beta_reader'
  | 'illustrator'
  | 'designer'
  | 'typesetter'
  | 'glossary'
  | 'community'
  | 'promo_writer'
  | 'other';

export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  lead:           'Лидер',
  translator:     'Переводчик',
  co_translator:  'Со-переводчик',
  editor:         'Редактор',
  proofreader:    'Корректор',
  beta_reader:    'Бета-ридер',
  illustrator:    'Иллюстратор',
  designer:       'Дизайнер',
  typesetter:     'Тайпсеттер',
  glossary:       'Глоссарий',
  community:      'Комьюнити',
  promo_writer:   'Промо-копирайтер',
  other:          'Другая роль',
};

// Все роли, которые можно назначить через invite-форму. lead — только
// автоматически при создании команды (RPC create_my_team).
export const TEAM_ROLE_INVITE_OPTIONS: TeamRole[] = [
  'translator',
  'co_translator',
  'editor',
  'proofreader',
  'beta_reader',
  'illustrator',
  'designer',
  'typesetter',
  'glossary',
  'community',
  'promo_writer',
  'other',
];

export interface TeamRow {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  owner_id: string;
  accepts_coins_for_chapters: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  // join'ы из team_view
  owner_user_name?: string | null;
  owner_display_name?: string | null;
  owner_avatar_url?: string | null;
  owner_translator_slug?: string | null;
  novel_count?: number;
  member_count?: number;
}

export interface TeamMemberRow {
  id: number;
  team_id: number;
  user_id: string;
  role: TeamRole;
  share_percent: number;
  note: string | null;
  sort_order: number;
  joined_at: string;
  // join'ы из team_members_view
  user_name: string | null;
  translator_display_name: string | null;
  translator_slug: string | null;
  avatar_url: string | null;
  translator_about: string | null;
}

// Один пользователь — одна команда, владельцем которой он является.
// Команд, где он просто участник, может быть много.
export async function fetchMyOwnedTeam(
  supabase: SupabaseClient,
  userId: string
): Promise<TeamRow | null> {
  const { data } = await supabase
    .from('team_view')
    .select('*')
    .eq('owner_id', userId)
    .eq('is_archived', false)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data ?? null) as TeamRow | null;
}

export async function fetchTeamBySlug(
  supabase: SupabaseClient,
  slug: string
): Promise<TeamRow | null> {
  const { data } = await supabase
    .from('team_view')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  return (data ?? null) as TeamRow | null;
}

export async function fetchTeamMembers(
  supabase: SupabaseClient,
  teamId: number
): Promise<TeamMemberRow[]> {
  const { data } = await supabase
    .from('team_members_view')
    .select('*')
    .eq('team_id', teamId)
    .order('sort_order', { ascending: true });
  return (data ?? []) as TeamMemberRow[];
}

export function teamHref(slug: string): string {
  return `/team/${slug}`;
}

// Куда открывать профиль участника. Если у юзера есть translator_slug —
// у него есть публичная страница переводчика /t/[slug]. Иначе — общий
// профиль /u/[id].
export function memberProfileHref(m: TeamMemberRow): string {
  return m.translator_slug ? `/t/${m.translator_slug}` : `/u/${m.user_id}`;
}

export function memberDisplayName(m: TeamMemberRow): string {
  return m.translator_display_name || m.user_name || 'Без имени';
}
