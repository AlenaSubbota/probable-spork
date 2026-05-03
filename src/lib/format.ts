import { transliterateRu } from './translit';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// Timestamp-rand формат, который создаёт наш CoverUpload: `<ms>-<rand>.<ext>`
const UPLOAD_RE = /^\d{10,}-[a-z0-9]{4,}\./i;

// Прямые URL на tene.fun (исторически в БД хранятся именно так:
//   https://tene.fun/storage/v1/object/public/<bucket>/<path> — Supabase
//   https://tene.fun/covers/<filename>                        — легаси-статика)
// переписываем на same-origin /sb-storage/<...> или /covers/<...>. Иначе
// браузер ходит напрямую к tene.fun, минуя chaptify.ru-nginx-кэш и упираясь
// в Safari ITP — там loading-индикатор висит «вечно», пока tene.fun не
// догрузит ресурсы.
const TENE_STORAGE_RE = /^https?:\/\/(?:www\.)?tene\.fun\/storage\/(.+)$/i;
const TENE_COVERS_RE  = /^https?:\/\/(?:www\.)?tene\.fun\/covers\/(.+)$/i;

function rewriteTeneUrl(url: string): string {
  const s = url.match(TENE_STORAGE_RE);
  if (s) return `/sb-storage/${s[1]}`;
  const c = url.match(TENE_COVERS_RE);
  if (c) return `/covers/${c[1]}`;
  return url;
}

export function getCoverUrl(path: string | null | undefined) {
  if (!path) return null;
  if (path.startsWith('http')) return rewriteTeneUrl(path);

  // Все пути ниже возвращаем как same-origin relative URLs (`/covers/*`,
  // `/sb-storage/*`) — Next.config rewrites проксирует их через наш
  // backend на tene.fun. Прямые https://tene.fun ссылки из браузера
  // не работали в Safari desktop (ITP/TLS вешали соединение).

  // В старой базе tene cover_url часто лежит с префиксом «covers/» — это
  // 22 легаси-новеллы (см. scripts/migrate-legacy-covers-to-storage.mjs).
  // После миграции файлы лежат в Supabase Storage bucket `covers` под
  // транслитерированными ASCII-именами (Supabase отказывает на кириллице
  // в ключах: «Invalid key: скан.webp»). Применяем ту же транслитерацию,
  // что и скрипт миграции, чтобы фронт и bucket сошлись на одном имени.
  // На tene.fun cover_url в БД не меняли — там путь по-прежнему обслуживает
  // tene-frontend-app:80/covers/<оригинал>.webp с кириллицей.
  if (path.startsWith('covers/')) {
    const filename = path.slice('covers/'.length);
    const ascii = transliterateRu(filename);
    return `/sb-storage/v1/object/public/covers/${encodeURIComponent(ascii)}`;
  }

  // Новые загрузки через CoverUpload: UUID-like или timestamp-rand имена → Supabase Storage
  if (UUID_RE.test(path) || UPLOAD_RE.test(path)) {
    return `/sb-storage/v1/object/public/covers/${encodeURIComponent(path)}`;
  }

  // Старые обложки tene — прямое имя файла в /covers/
  return `/covers/${encodeURIComponent(path)}`;
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'только что';
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min} мин. назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч. назад`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} дн. назад`;
  return new Date(iso).toLocaleDateString('ru-RU');
}

// Имя автора в трёх вариантах: оригинал / транслит / русский — через
// тонкий разделитель. Дубли (когда два варианта совпадают) свёрнуты.
// Возвращает пустую строку, если ни один вариант не задан, — это
// удобно для `?? 'Автор не указан'` на стороне вызова.
//
// Используется на ДЕТАЛЬНОЙ странице новеллы, где места достаточно.
// На карточках в гридах, где места мало, нужен `formatAuthorPrimary`
// — он берёт только один вариант (русский, иначе транслит, иначе
// оригинал), чтобы строка не уезжала на две и не ломала сетку.
export function formatAuthorVariants(
  ru: string | null | undefined,
  en: string | null | undefined,
  original: string | null | undefined
): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [original, en, ru]) {
    const v = raw?.trim();
    if (!v) continue;
    const key = v.toLocaleLowerCase('ru');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out.join(' / ');
}

// Главный вариант имени автора для компактных мест (карточки гридов,
// поиск, лента). Приоритет: русский → транслит → оригинал. Если ни
// один не задан — пустая строка.
export function formatAuthorPrimary(
  ru: string | null | undefined,
  en: string | null | undefined,
  original: string | null | undefined
): string {
  return (ru?.trim() || en?.trim() || original?.trim() || '');
}

// Возрастные «жанры» в реальности — возрастной рейтинг новеллы, а не
// её жанр. Tene-сайт исторически складывал «18+», «16+» и т.п. в
// novels.genres вместе с настоящими жанрами; в Chaptify рейтинг
// живёт в отдельной колонке age_rating, поэтому возрастные токены
// в списке жанров — паразитные. Чистим везде, где жанры показываются
// читателю.
const AGE_TOKEN_RE = /^\d{1,2}\+$/;
export function cleanGenres(
  genres: unknown
): string[] {
  if (!Array.isArray(genres)) return [];
  return genres.filter(
    (g): g is string =>
      typeof g === 'string' && g.trim().length > 0 && !AGE_TOKEN_RE.test(g.trim())
  );
}

// Простая русская плюрализация: pluralRu(1, 'оценка', 'оценки', 'оценок')
// → 'оценка'. Учитывает 11–14 (особый случай → many).
export function pluralRu(
  n: number,
  one: string,
  few: string,
  many: string
): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 19) return many;
  if (m10 === 1) return one;
  if (m10 >= 2 && m10 <= 4) return few;
  return many;
}

export function formatCount(n: number | null | undefined) {
  if (!n) return '0';
  if (n >= 1000) {
    return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`.replace('.0', '');
  }
  return n.toLocaleString('ru-RU');
}
