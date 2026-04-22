import type { Metadata } from "next";
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
