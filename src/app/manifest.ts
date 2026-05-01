import type { MetadataRoute } from 'next';

// Web App Manifest — PWA metadata. С ним:
//   - на iOS Safari появляется «Добавить на экран Домой» с правильной
//     иконкой/именем
//   - на Android в Chrome — установка как PWA
//   - в Telegram WebApp — title из manifest используется в шапке
//
// Иконки ссылаются на /favicon.ico и потенциально дополнительные PNG
// в /public/. Если PNG-иконки нужного размера не загружены — Chrome
// будет fallback'ить на favicon, что приемлемо.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Chaptify — корейские и японские новеллы',
    short_name: 'Chaptify',
    description:
      'Лучшие переводы корейских и японских новелл. Удобная читалка, закладки, рекомендации читателей.',
    start_url: '/',
    display: 'standalone',
    background_color: '#F5EFE6',
    theme_color: '#F5EFE6',
    lang: 'ru',
    orientation: 'portrait',
    icons: [
      {
        src: '/favicon.ico',
        sizes: 'any',
        type: 'image/x-icon',
      },
    ],
    categories: ['books', 'entertainment', 'lifestyle'],
  };
}
