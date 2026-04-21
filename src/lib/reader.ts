// -----------------------------------------------------------
// Настройки читалки. Адаптировано из tene ChapterReader.jsx,
// но без мобильных страничных режимов — для десктопа/планшета
// достаточно вертикального скролла.
// -----------------------------------------------------------

export type FontFamilyKey = 'sans' | 'serif' | 'merriweather' | 'roboto' | 'dyslexic';

export interface FontOption {
  key: FontFamilyKey;
  label: string;
  css: string;          // значение для font-family
  description?: string;
}

export const FONT_OPTIONS: FontOption[] = [
  { key: 'sans',         label: 'Inter',        css: 'var(--font-sans), system-ui, sans-serif' },
  { key: 'serif',        label: 'Lora',         css: '"Lora", Georgia, serif' },
  { key: 'merriweather', label: 'Merriweather', css: '"Merriweather", Georgia, serif' },
  { key: 'roboto',       label: 'Roboto',       css: '"Roboto", system-ui, sans-serif' },
  { key: 'dyslexic',     label: 'OpenDyslexic', css: '"OpenDyslexic", "Atkinson Hyperlegible", sans-serif', description: 'Для тех, кому сложнее с обычным шрифтом' },
];

export type TextAlign = 'left' | 'justify';

export interface ReaderSettings {
  fontFamily:      FontFamilyKey;
  fontSize:        number;
  lineHeight:      number;
  textAlign:       TextAlign;
  textIndent:      number;   // em
  paragraphSpacing: number;  // em
  focusMode:       boolean;  // киллер-фича #1
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontFamily: 'serif',
  fontSize: 18,
  lineHeight: 1.7,
  textAlign: 'justify',
  textIndent: 1.5,
  paragraphSpacing: 0.8,
  focusMode: false,
};

// Пределы значений (чтобы случайно не сломать глазами)
export const LIMITS = {
  fontSize:   { min: 13, max: 26, step: 1   },
  lineHeight: { min: 1.2, max: 2.5, step: 0.1 },
  textIndent: { min: 0,   max: 3,   step: 0.5 },
  paragraphSpacing: { min: 0.5, max: 2.0, step: 0.1 },
};

export const STORAGE_KEY = 'chaptify-reader-settings';

export function loadSettings(): ReaderSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: ReaderSettings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

export function getFontCss(key: FontFamilyKey): string {
  return FONT_OPTIONS.find((o) => o.key === key)?.css ?? FONT_OPTIONS[0].css;
}

// Таймер сна: доступные пресеты (мин)
export const SLEEP_TIMER_PRESETS = [15, 30, 45, 60] as const;
