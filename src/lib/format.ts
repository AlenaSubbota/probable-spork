const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// Timestamp-rand формат, который создаёт наш CoverUpload: `<ms>-<rand>.<ext>`
const UPLOAD_RE = /^\d{10,}-[a-z0-9]{4,}\./i;

export function getCoverUrl(path: string | null | undefined) {
  if (!path) return null;
  if (path.startsWith('http')) return path;

  // Все пути ниже возвращаем как same-origin relative URLs (`/covers/*`,
  // `/sb-storage/*`) — Next.config rewrites проксирует их через наш
  // backend на tene.fun. Прямые https://tene.fun ссылки из браузера
  // не работали в Safari desktop (ITP/TLS вешали соединение).

  // В старой базе tene cover_url часто лежит с префиксом «covers/» —
  // не добавляем его повторно, только кодируем имя файла.
  if (path.startsWith('covers/')) {
    const filename = path.slice('covers/'.length);
    return `/covers/${encodeURIComponent(filename)}`;
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

export function formatCount(n: number | null | undefined) {
  if (!n) return '0';
  if (n >= 1000) {
    return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`.replace('.0', '');
  }
  return n.toLocaleString('ru-RU');
}
