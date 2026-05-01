import type { Metadata, Viewport } from "next";
import { Manrope, Lora } from "next/font/google";
import "./globals.css";
import "./reader-keyboard-fix.css";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import HeaderRefreshOnVisibility from "@/components/HeaderRefreshOnVisibility";
import ReaderKeyboardDetector from "@/components/ReaderKeyboardDetector";

// UI-шрифт: Manrope — тёплый, современный grotesk с хорошей кириллицей
// и мягким округлением. Лучше вписывается в «бумажную» палитру сайта,
// чем строгий Inter. Variable font, один файл под все веса 200–800.
const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  variable: "--font-sans",
  display: "swap",
});

// Заголовки и читалка: Lora — классический книжный serif с отличной
// кириллицей. Вариативный, поддерживает italic. Остаётся как был.
const lora = Lora({
  subsets: ["latin", "cyrillic"],
  variable: "--font-serif",
  display: "swap",
});

// metadataBase нужен для того чтобы Next правильно резолвил относительные
// URL в Open Graph / Twitter / canonical. Без него превью в Telegram/VK
// получают только текст без картинки. Если открываем сайт на staging-домене
// — переопределить через NEXT_PUBLIC_SITE_URL env.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://chaptify.ru';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    // template используется страницами для генерации заголовков вида
    // «Название новеллы — Chaptify». На страницах без своего title
    // показывается defaultBase (см. ниже).
    default: 'Chaptify — читайте корейские и японские новеллы онлайн',
    template: '%s — Chaptify',
  },
  description:
    'Лучшие переводы корейских и японских новелл. Романтика, фэнтези, исэкай, школьные драмы. Удобная читалка, закладки, рекомендации читателей.',
  applicationName: 'Chaptify',
  keywords: [
    'новеллы', 'корейские новеллы', 'японские новеллы', 'ранобэ',
    'веб-новеллы', 'переводы новелл', 'читать онлайн',
    'романтическое фэнтези', 'исэкай', 'манхва',
  ],
  openGraph: {
    type: 'website',
    siteName: 'Chaptify',
    locale: 'ru_RU',
    url: SITE_URL,
    title: 'Chaptify — читайте корейские и японские новеллы онлайн',
    description:
      'Лучшие переводы корейских и японских новелл. Удобная читалка, закладки, рекомендации читателей.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Chaptify',
    description:
      'Лучшие переводы корейских и японских новелл онлайн.',
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: '/favicon.ico',
  },
};

// Viewport: device-width + initial-scale=1 — это дефолт Next.js 16, но
// мы явно задаём viewport-fit=cover, чтобы на iPhone X+ контент уходил
// в safe-area (notch / bottom home-indicator). CSS-переменные
// env(safe-area-inset-*) после этого начинают отдавать ненулевые
// значения, и мы можем сдвинуть sticky-элементы ниже notch.
//
// userScalable оставляем дефолтно true — иначе люди со слабым зрением
// не смогут ущипнуть pinch-to-zoom.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F5EFE6",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ru"
      className={`${manrope.variable} ${lora.variable} h-full antialiased`}
    >
      <head>
        {/* Anti-FOUC для тёмной темы: синхронный внешний скрипт в
            <head> устанавливает data-theme ДО первого paint. Иначе
            страница мигнёт светлой → тёмной при загрузке.
            Вынесено во внешний файл /theme-init.js, чтобы проходить
            строгий CSP (script-src 'self') без 'unsafe-inline'/nonce. */}
        <script src="/theme-init.js" />
      </head>
      <body className="min-h-full flex flex-col">
        <SiteHeader />
        <HeaderRefreshOnVisibility />
        <ReaderKeyboardDetector />
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
