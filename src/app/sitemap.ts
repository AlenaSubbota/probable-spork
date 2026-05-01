import type { MetadataRoute } from 'next';
import { createClient } from '@/utils/supabase/server';

// Sitemap для поисковиков. Включаем:
//   - статические страницы (главная, каталог, /about, /help, /rules,
//     /privacy, /terms, /cookies, /contacts, /teams, /collections, /news, /market)
//   - все опубликованные новеллы (/novel/<firebase_id>)
//   - страницы переводчиков (/t/<slug>) для тех у кого slug настроен
//   - публичные коллекции (/collection/<slug>)
//   - команды (/team/<slug>) которые публичные
//   - новости (/news/<id>)
//
// changeFrequency и priority — подсказки, не гарантии. Главная и каталог
// — приоритет 1.0, новеллы — 0.8 (контент сайта), профили — 0.5,
// статика — 0.3.
//
// ⚠ Лимит Google для sitemap.xml — 50000 URL / 50MB. У нас новелл явно
// меньше, но если когда-то будет 50K+ — разбить на sitemap-index с
// шардами (sitemap-novels-1.xml и т.д.).

const BASE = 'https://chaptify.ru';
const STATIC_FREQ = 'monthly' as const;
const NOVEL_FREQ = 'weekly' as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const supabase = await createClient();

  // ---- Статические страницы ----
  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE, lastModified: now, changeFrequency: 'daily', priority: 1.0 },
    { url: `${BASE}/catalog`, lastModified: now, changeFrequency: 'daily', priority: 1.0 },
    { url: `${BASE}/teams`, lastModified: now, changeFrequency: 'weekly', priority: 0.5 },
    { url: `${BASE}/collections`, lastModified: now, changeFrequency: 'weekly', priority: 0.5 },
    { url: `${BASE}/news`, lastModified: now, changeFrequency: 'daily', priority: 0.6 },
    { url: `${BASE}/market`, lastModified: now, changeFrequency: 'daily', priority: 0.5 },
    { url: `${BASE}/about`, lastModified: now, changeFrequency: STATIC_FREQ, priority: 0.3 },
    { url: `${BASE}/help`, lastModified: now, changeFrequency: STATIC_FREQ, priority: 0.3 },
    { url: `${BASE}/rules`, lastModified: now, changeFrequency: STATIC_FREQ, priority: 0.3 },
    { url: `${BASE}/privacy`, lastModified: now, changeFrequency: STATIC_FREQ, priority: 0.3 },
    { url: `${BASE}/terms`, lastModified: now, changeFrequency: STATIC_FREQ, priority: 0.3 },
    { url: `${BASE}/cookies`, lastModified: now, changeFrequency: STATIC_FREQ, priority: 0.3 },
    { url: `${BASE}/contacts`, lastModified: now, changeFrequency: STATIC_FREQ, priority: 0.3 },
  ];

  // ---- Опубликованные новеллы ----
  // Берём firebase_id (это slug в URL) + last_chapter_at для lastModified.
  // Если supabase сейчас недоступен / RPC падает — отдаём что собрали.
  let novelPages: MetadataRoute.Sitemap = [];
  try {
    const { data: novels } = await supabase
      .from('novels_view')
      .select('firebase_id, last_chapter_at')
      .eq('moderation_status', 'published')
      .order('last_chapter_at', { ascending: false, nullsFirst: false })
      .limit(10000);
    novelPages = (novels ?? []).map((n) => ({
      url: `${BASE}/novel/${n.firebase_id}`,
      lastModified: n.last_chapter_at ? new Date(n.last_chapter_at as string) : now,
      changeFrequency: NOVEL_FREQ,
      priority: 0.8,
    }));
  } catch {
    /* sitemap не должен падать целиком если одна выборка не получилась */
  }

  // ---- Профили переводчиков (только с настроенным slug) ----
  let translatorPages: MetadataRoute.Sitemap = [];
  try {
    const { data: tprofs } = await supabase
      .from('public_profiles')
      .select('translator_slug')
      .not('translator_slug', 'is', null)
      .limit(10000);
    translatorPages = (tprofs ?? [])
      .filter((p) => !!p.translator_slug)
      .map((p) => ({
        url: `${BASE}/t/${p.translator_slug}`,
        lastModified: now,
        changeFrequency: 'weekly' as const,
        priority: 0.5,
      }));
  } catch {}

  // ---- Команды переводчиков ----
  let teamPages: MetadataRoute.Sitemap = [];
  try {
    const { data: teams } = await supabase
      .from('team_view')
      .select('slug')
      .not('slug', 'is', null)
      .limit(10000);
    teamPages = (teams ?? [])
      .filter((t) => !!t.slug)
      .map((t) => ({
        url: `${BASE}/team/${t.slug}`,
        lastModified: now,
        changeFrequency: 'weekly' as const,
        priority: 0.5,
      }));
  } catch {}

  // ---- Публичные коллекции ----
  let collectionPages: MetadataRoute.Sitemap = [];
  try {
    const { data: cols } = await supabase
      .from('collections')
      .select('slug, updated_at')
      .eq('is_public', true)
      .limit(10000);
    collectionPages = (cols ?? [])
      .filter((c) => !!c.slug)
      .map((c) => ({
        url: `${BASE}/collection/${c.slug}`,
        lastModified: c.updated_at ? new Date(c.updated_at as string) : now,
        changeFrequency: 'monthly' as const,
        priority: 0.4,
      }));
  } catch {}

  return [
    ...staticPages,
    ...novelPages,
    ...translatorPages,
    ...teamPages,
    ...collectionPages,
  ];
}
