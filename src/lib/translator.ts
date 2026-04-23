import type { SupabaseClient } from '@supabase/supabase-js';

// Подтягивает slugs переводчиков по списку translator_id. Возвращает
// Map<translator_id, slug> — для передачи в NovelCard.translatorSlug.
// Fallback на user_name если translator_slug не задан (часто у старых
// tene-профилей).
export async function fetchTranslatorSlugs(
  supabase: SupabaseClient,
  ids: Array<string | null | undefined>
): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (uniq.length === 0) return new Map();

  // Идём через public_profiles (мигр. 040): RLS на profiles разрешает
  // SELECT только своего, поэтому прямой запрос вернёт пусто для чужих
  // переводчиков и слаги в карточках не отрисуются.
  const { data } = await supabase
    .from('public_profiles')
    .select('id, translator_slug, user_name')
    .in('id', uniq);

  const map = new Map<string, string>();
  for (const p of data ?? []) {
    const slug = p.translator_slug || p.user_name;
    if (slug) map.set(p.id, slug);
  }
  return map;
}
