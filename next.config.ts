import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',

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
};

export default nextConfig;
