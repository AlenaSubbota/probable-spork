import type { Metadata, Viewport } from "next";
import { Inter, Lora } from "next/font/google";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import HeaderRefreshOnVisibility from "@/components/HeaderRefreshOnVisibility";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-sans",
});

const lora = Lora({
  subsets: ["latin", "cyrillic"],
  variable: "--font-serif",
});

export const metadata: Metadata = {
  title: "Chaptify — читайте новеллы онлайн",
  description: "Лучшие переводы корейских и японских новелл. Романтика, фэнтези, экшен.",
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
      className={`${inter.variable} ${lora.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SiteHeader />
        <HeaderRefreshOnVisibility />
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
