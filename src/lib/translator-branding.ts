// Брендинг переводчика — палитра + печать-марка.
//
// Whitelist'ы синхронизированы с CHECK-constraint'ами в миграции 071.
// Если добавляешь значение — добавь и туда, и в globals.css (там
// рендерятся CSS-кастомы для каждой палитры, и SVG-печатей в
// TranslatorSeal.tsx).

export const BRAND_PALETTES = [
  'amber',
  'midnight',
  'sage',
  'rose',
  'ink',
  'paper',
] as const;

export const BRAND_SEALS = [
  'crescent',
  'star',
  'feather',
  'leaf',
  'flame',
  'wave',
  'compass',
  'key',
] as const;

export type BrandPalette = (typeof BRAND_PALETTES)[number];
export type BrandSeal = (typeof BRAND_SEALS)[number];

export interface PalettePreset {
  id: BrandPalette;
  label: string;
  // Превью-цвет для кружочка в пикере. Это ровно тот hex, который
  // палитра подставляет в --tr-accent в светлой теме.
  preview: string;
  hint: string;
}

export interface SealPreset {
  id: BrandSeal;
  label: string;
}

export const PALETTE_PRESETS: PalettePreset[] = [
  { id: 'amber',    label: 'Амбра',     preview: '#B8763C', hint: 'Тёплый янтарь — авантюрные истории, сказочный ромфэнтези.' },
  { id: 'midnight', label: 'Полночь',   preview: '#5B6CB8', hint: 'Глубокий индиго — мистика, нуар, звёздные миры.' },
  { id: 'sage',     label: 'Шалфей',    preview: '#7A9B72', hint: 'Зелёный мягкий — слайсы, лёгкая повседневность, природа.' },
  { id: 'rose',     label: 'Шиповник',  preview: '#C57386', hint: 'Розовый припылённый — романтика, эмоции, девичьи новеллы.' },
  { id: 'ink',      label: 'Тушь',      preview: '#3E3A36', hint: 'Графитовый — серьёзная проза, исторические, философия.' },
  { id: 'paper',    label: 'Бумага',    preview: '#A89A82', hint: 'Песочно-бежевый — нейтральный, под любые жанры.' },
];

export const SEAL_PRESETS: SealPreset[] = [
  { id: 'crescent', label: 'Полумесяц' },
  { id: 'star',     label: 'Звезда' },
  { id: 'feather',  label: 'Перо' },
  { id: 'leaf',     label: 'Лист' },
  { id: 'flame',    label: 'Пламя' },
  { id: 'wave',     label: 'Волна' },
  { id: 'compass',  label: 'Компас' },
  { id: 'key',      label: 'Ключ' },
];

// Предохранитель: к нам с сервера может прилететь старое/невалидное
// значение (например, переводчик удалил палитру руками в БД, или
// миграция 071 ещё не накачена). Возвращаем null — рендерим как
// раньше, без брендинга.
export function normalizePalette(value: unknown): BrandPalette | null {
  if (typeof value !== 'string') return null;
  return (BRAND_PALETTES as readonly string[]).includes(value)
    ? (value as BrandPalette)
    : null;
}

export function normalizeSeal(value: unknown): BrandSeal | null {
  if (typeof value !== 'string') return null;
  return (BRAND_SEALS as readonly string[]).includes(value)
    ? (value as BrandSeal)
    : null;
}

// Удобный шортхэнд: нормализует обе части и возвращает «активный
// бренд» только если хоть одна из частей задана. Если null — UI
// должен пропустить весь брендинг-слой.
export interface TranslatorBrand {
  palette: BrandPalette | null;
  seal: BrandSeal | null;
}

export function readBrand(p: {
  translator_brand_palette?: string | null;
  translator_brand_seal?: string | null;
}): TranslatorBrand | null {
  const palette = normalizePalette(p.translator_brand_palette);
  const seal = normalizeSeal(p.translator_brand_seal);
  if (!palette && !seal) return null;
  return { palette, seal };
}
