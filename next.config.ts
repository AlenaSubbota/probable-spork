import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',

  // ВНИМАНИЕ: НЕ возвращай isomorphic-dompurify / DOMPurify в зависимости.
  // dompurify имеет 5 свободных ссылок на DOM-глобал `Element`; в Next 16
  // + output:'standalone' standalone-build вшивает пакет в server bundle
  // ИГНОРИРУЯ serverExternalPackages — `Element` остаётся unbound и каждая
  // SSR-страница с sanitizeUgcHtml валится `ReferenceError: Element is not
  // defined`. История: коммиты d058d3d → 8b0d3da → 43b6719. Сейчас санитайзер
  // (src/lib/sanitize.ts) использует sanitize-html — pure JS, htmlparser2,
  // без DOM-глобалов.

  // Проксируем картинки обложек и аватарок с легаси-домена tene.fun
  // через chaptify.ru. Safari desktop-у плохо резолвится /связывается
  // с tene.fun (DNS/TLS/ITP пакет блокирует ресурсы до одномашинного
  // хоста) — вкладка висит с window.load никогда не срабатывающим
  // потому что картинки не догружаются. Под same-origin всё летит
  // через наш nginx и Safari доволен.
  //
  // Страницы сайта по-прежнему видят пути `/covers/...` и
  // `/sb-storage/...` как относительные; SSR node-процесс на
  // backend'е тянет реальные файлы с tene.fun и проксирует байты.
  //
  // ⚠ ПРИ ВЫКЛЮЧЕНИИ TENE-ФРОНТЕНДА (легаси-домен tene.fun перестанет
  // работать) — обновить destination'ы на:
  //   - chaptify.ru-nginx, который проксирует напрямую к Supabase
  //     Storage (`https://<supabase-host>/storage/v1/object/public/`),
  //     ИЛИ
  //   - прямой Supabase URL (но тогда вернётся проблема Safari ITP
  //     для /covers/, придётся отдавать через Image-CDN или
  //     добавить CORS-заголовки на bucket).
  // Подробнее: см. ауди в коммите `dbfc6ea` и обсуждение в чате.
  async rewrites() {
    return [
      {
        source: '/covers/:path*',
        destination: 'https://tene.fun/covers/:path*',
      },
      {
        source: '/sb-storage/:path*',
        destination: 'https://tene.fun/storage/:path*',
      },
    ];
  },

  // Security headers. CSP — defense-in-depth для UGC HTML (описания,
  // главы, новости). При найденной XSS он не даст утянуть данные на
  // attacker.com и блокирует inline-script в загруженной главе.
  // 'unsafe-inline' для style-src оставлен — Next встраивает критический
  // CSS как inline; если нужно ужесточить, генерь nonce в middleware.
  async headers() {
    const supabaseHost = (() => {
      try {
        return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname;
      } catch {
        return '';
      }
    })();
    const csp = [
      "default-src 'self'",
      // Next дёргает inline-bootstrap, оставляем 'unsafe-inline' для script
      // и 'unsafe-eval' для dev-mode HMR. На проде HMR нет, но React Server
      // Components в Next 16 могут тащить eval в каких-то корнер-кейсах —
      // безопаснее держать здесь, чем сломать прод.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://telegram.org",
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob: ${supabaseHost ? `https://${supabaseHost}` : ''} https://tene.fun https://chaptify.ru https://t.me`.trim(),
      `connect-src 'self' ${supabaseHost ? `https://${supabaseHost} wss://${supabaseHost}` : ''} https://tene.fun`.trim(),
      "font-src 'self' data:",
      "frame-src 'self' https://oauth.telegram.org https://t.me",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
