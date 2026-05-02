// -----------------------------------------------------------
// Аватары: пресеты (градиенты с буквой) + разрешение URL.
// Значение поля profiles.avatar_url может быть:
//   - null → показываем default placeholder (градиент + initial)
//   - 'preset:1' … 'preset:8' → рисуем CSS-градиент из палитры
//   - http(s)://… → внешний URL (например, из Telegram)
//   - <user_id>/<filename>.ext → файл в Supabase Storage bucket avatars
// -----------------------------------------------------------

export const AVATAR_PRESETS = [
  { id: 1, css: 'linear-gradient(135deg, #8C5A3C 0%, #C9A35F 100%)' },
  { id: 2, css: 'linear-gradient(135deg, #B4766A 0%, #EAC8B5 100%)' },
  { id: 3, css: 'linear-gradient(135deg, #6F4227 0%, #8BA076 100%)' },
  { id: 4, css: 'linear-gradient(135deg, #2B2017 0%, #8C5A3C 100%)' },
  { id: 5, css: 'linear-gradient(135deg, #D9BFA6 0%, #8C5A3C 100%)' },
  { id: 6, css: 'linear-gradient(135deg, #5A4A3B 0%, #C9A35F 100%)' },
  { id: 7, css: 'linear-gradient(135deg, #C9A35F 0%, #FBF7F0 100%)' },
  { id: 8, css: 'linear-gradient(135deg, #8BA076 0%, #2B2017 100%)' },
] as const;

export function getPresetCss(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl || !avatarUrl.startsWith('preset:')) return null;
  const id = parseInt(avatarUrl.slice('preset:'.length), 10);
  return AVATAR_PRESETS.find((p) => p.id === id)?.css ?? null;
}

// Прямые URL на tene.fun storage (исторически часть аватаров хранится
// именно так) переписываем на same-origin /sb-storage/<...>. Без этого
// браузер ходит на tene.fun напрямую, и Safari/WKWebView вешает
// loading-индикатор из-за ITP. См. подробнее в src/lib/format.ts.
const TENE_STORAGE_RE = /^https?:\/\/(?:www\.)?tene\.fun\/storage\/(.+)$/i;

export function resolveAvatarUrl(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl) return null;
  if (avatarUrl.startsWith('preset:')) return null;   // пресет → CSS, не URL
  if (avatarUrl.startsWith('http')) {
    const m = avatarUrl.match(TENE_STORAGE_RE);
    if (m) return `/sb-storage/${m[1]}`;
    return avatarUrl;                                 // внешний (Telegram / прочий CDN)
  }
  // Relative path в bucket avatars — same-origin через next.config
  // rewrite `/sb-storage/*` → tene.fun/storage/*. Safari desktop
  // не ходит к tene.fun напрямую, поэтому все supabase-storage ссылки
  // проксируем через chaptify.ru.
  return `/sb-storage/v1/object/public/avatars/${avatarUrl}`;
}

/**
 * Всё, что нужно для рендера аватара: либо URL картинки,
 * либо CSS-градиент для пресета, либо null (дефолт на инициал).
 */
export function describeAvatar(
  avatarUrl: string | null | undefined
): { kind: 'image'; src: string } | { kind: 'preset'; css: string } | { kind: 'initial' } {
  if (!avatarUrl) return { kind: 'initial' };
  const preset = getPresetCss(avatarUrl);
  if (preset) return { kind: 'preset', css: preset };
  const src = resolveAvatarUrl(avatarUrl);
  if (src) return { kind: 'image', src };
  return { kind: 'initial' };
}
