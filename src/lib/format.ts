export function getCoverUrl(path: string | null | undefined) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `https://tene.fun/storage/v1/object/public/covers/${path}`;
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