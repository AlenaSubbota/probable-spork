import type { SupabaseClient } from '@supabase/supabase-js';

export interface ThanksWallRow {
  id: number;
  reader_id: string;
  translator_id: string;
  novel_id: number | null;
  chapter_number: number | null;
  message: string;
  is_public: boolean;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  // join'ы
  reader_user_name: string | null;
  reader_display_name: string | null;
  reader_avatar_url: string | null;
  reader_translator_slug: string | null;
  novel_title: string | null;
  novel_firebase_id: string | null;
}

export async function fetchPublicThanksForTranslator(
  supabase: SupabaseClient,
  translatorId: string,
  limit = 20
): Promise<ThanksWallRow[]> {
  const { data } = await supabase
    .from('thanks_wall_view')
    .select('*')
    .eq('translator_id', translatorId)
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as ThanksWallRow[];
}

export async function fetchMyIncomingThanks(
  supabase: SupabaseClient,
  translatorId: string,
  limit = 100
): Promise<ThanksWallRow[]> {
  const { data } = await supabase
    .from('thanks_wall_view')
    .select('*')
    .eq('translator_id', translatorId)
    .order('is_read', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as ThanksWallRow[];
}

export function readerDisplayName(t: ThanksWallRow): string {
  return t.reader_display_name || t.reader_user_name || 'Читатель';
}

export function readerProfileHref(t: ThanksWallRow): string | null {
  if (t.reader_translator_slug) return `/t/${t.reader_translator_slug}`;
  return `/u/${t.reader_id}`;
}
