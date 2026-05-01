import type { MetadataRoute } from 'next';

// robots.txt генерируется через app/robots.ts (Next 16 convention).
// Закрываем от индексации:
//   - /admin/* — админка переводчика, ничего публичного
//   - /profile/* — личный кабинет
//   - /messages/* — личные сообщения
//   - /notifications — уведомления
//   - /friends, /bookmarks — личные подборки
//   - /api/* — API-роуты
//   - /auth/* — OAuth-callback и прочее служебное
//   - /login, /register — страницы аутентификации (UX-флоу, не контент)
//
// Открыто для краулинга:
//   - / (главная), /catalog, /novel/*, /t/* (профили переводчиков),
//     /team/*, /collection/*, /collections, /news/*, /help, /about,
//     /privacy, /terms, /cookies, /rules, /contacts, /teams, /market,
//     /streak, /search.

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin/',
          '/profile/',
          '/messages/',
          '/notifications',
          '/friends',
          '/bookmarks',
          '/api/',
          '/auth/',
          '/login',
          '/register',
          // Search-результаты тоже закрываем — они бесконечно
          // ветвятся по фильтрам и едят crawl-budget.
          '/search',
        ],
      },
    ],
    sitemap: 'https://chaptify.ru/sitemap.xml',
    host: 'https://chaptify.ru',
  };
}
