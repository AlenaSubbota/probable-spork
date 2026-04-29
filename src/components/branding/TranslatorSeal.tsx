import type { BrandSeal } from '@/lib/translator-branding';

// Печати-марки переводчика. Геометрические, с явным силуэтом,
// чтобы читались на 22px (в пикере) и на 56px (на сургучной
// печати под главой). currentColor → потомок CSS подсветит
// либо --tr-accent, либо нейтральным --ink-soft.

interface Props {
  seal: BrandSeal;
  // aria-hidden — подпись и так есть рядом текстом «Перевела X».
  // Если кто-то использует печать самостоятельно, передаст title.
  title?: string;
}

export default function TranslatorSeal({ seal, title }: Props) {
  const aria = title
    ? { role: 'img' as const, 'aria-label': title }
    : { 'aria-hidden': true as const };
  return (
    <svg viewBox="0 0 32 32" {...aria}>
      {SEAL_PATHS[seal]}
    </svg>
  );
}

const SEAL_PATHS: Record<BrandSeal, React.ReactNode> = {
  // Полумесяц: классический ислам/гнозис мотив, уютный и узнаваемый.
  crescent: (
    <path d="M21 4a12 12 0 1 0 0 24 9.5 9.5 0 1 1 0-24z" />
  ),
  // Звезда — пятиконечная, без «диснея»: чуть вытянутая.
  star: (
    <path d="M16 3.5l3.6 8.1 8.9 1-6.7 6 1.9 8.9L16 23l-7.7 4.5 1.9-8.9-6.7-6 8.9-1L16 3.5z" />
  ),
  // Перо — литературный мотив. Стержень + вёрхний край пера.
  feather: (
    <path d="M24 4c-9 0-15 6-15 14v10l3-3h2c8 0 14-6 14-15V4h-4zm-2 5c0 6-4 10-10 10l10-10z" />
  ),
  // Лист — для «зелёных» и слайс-новелл.
  leaf: (
    <path d="M5 27c0-12 9-22 22-22-1 13-9 22-22 22zm3-3l11-11" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
  ),
  // Пламя — динамика, страсть.
  flame: (
    <path d="M16 2s-7 6-7 13a7 7 0 0 0 14 0c0-4-3-6-3-9 0 0-2 2-4 1s0-5 0-5zm0 16a4 4 0 0 1-4-4c0-2 2-4 2-4s0 2 2 2 1-3 1-3 3 2 3 5a4 4 0 0 1-4 4z" />
  ),
  // Волна — морские/восточные темы, ровный ритм.
  wave: (
    <path d="M3 19c4 0 4-4 8-4s4 4 8 4 4-4 8-4 4 4 8 4M3 11c4 0 4-4 8-4s4 4 8 4 4-4 8-4 4 4 8 4M3 27c4 0 4-4 8-4s4 4 8 4 4-4 8-4 4 4 8 4" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
  ),
  // Компас — приключения, путешествия, исекаи.
  compass: (
    <>
      <circle cx="16" cy="16" r="12" stroke="currentColor" strokeWidth="2" fill="none" />
      <path d="M16 7l3 9-3 9-3-9 3-9z" />
      <circle cx="16" cy="16" r="1.5" />
    </>
  ),
  // Ключ — детектив, тайны, мистика.
  key: (
    <>
      <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="2.5" fill="none" />
      <path d="M15.5 15.5l11 11M21 21l3-3M24 24l3-3" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </>
  ),
};
