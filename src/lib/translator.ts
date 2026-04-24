import type { SupabaseClient } from '@supabase/supabase-js';

export interface TranslatorInfo {
  slug: string;
  name: string;
}

// Подтягивает slug+display-name переводчиков по списку translator_id.
// Одного запроса в public_profiles хватает обоим — через эту же мапу
// делаем slug-кликалки в карточках и подписи «от <переводчика>».
export async function fetchTranslators(
  supabase: SupabaseClient,
  ids: Array<string | null | undefined>
): Promise<Map<string, TranslatorInfo>> {
  const uniq = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (uniq.length === 0) return new Map();

  // public_profiles (мигр. 040): обход RLS profiles, возвращает
  // обезличенные поля чужих переводчиков.
  const { data } = await supabase
    .from('public_profiles')
    .select('id, translator_slug, user_name, translator_display_name')
    .in('id', uniq);

  const map = new Map<string, TranslatorInfo>();
  for (const p of data ?? []) {
    const slug = p.translator_slug || p.user_name;
    const name = p.translator_display_name || p.user_name || p.translator_slug;
    if (slug) map.set(p.id, { slug, name: name || slug });
  }
  return map;
}

// Тонкая обёртка над fetchTranslators для старых мест, которым нужен
// только slug — оставляем API.
export async function fetchTranslatorSlugs(
  supabase: SupabaseClient,
  ids: Array<string | null | undefined>
): Promise<Map<string, string>> {
  const full = await fetchTranslators(supabase, ids);
  const map = new Map<string, string>();
  for (const [id, info] of full) map.set(id, info.slug);
  return map;
}
