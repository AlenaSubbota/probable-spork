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
  // key='sans' исторически — теперь это Manrope (var(--font-sans)).
  { key: 'sans',         label: 'Manrope',      css: 'var(--font-sans), system-ui, sans-serif' },
  { key: 'serif',        label: 'Lora',         css: '"Lora", Georgia, serif' },
  { key: 'merriweather', label: 'Merriweather', css: '"Merriweather", Georgia, serif' },
  { key: 'roboto',       label: 'Roboto',       css: '"Roboto", system-ui, sans-serif' },
  { key: 'dyslexic',     label: 'OpenDyslexic', css: '"OpenDyslexic", "Atkinson Hyperlegible", sans-serif', description: 'Для тех, кому сложнее с обычным шрифтом' },
];

export type TextAlign = 'left' | 'justify';

// Тема читалки: на данный момент только светлая кремовая бумага.
// Сепия и тёмная были убраны — в общем dark-mode сайт уже темнеет через
// html[data-theme], а внутри читалки лишний пресет тёмного только
// путает и спорит с глобальным переключателем.
export type ReaderTheme = 'light';

// Режим чтения:
// - scroll: привычный вертикальный свиток (дефолт десктопа)
// - pages:  text в multi-column + горизонтальный свайп (привычнее
//           тем, кто читает в читалках книг)
export type ReadMode = 'scroll' | 'pages';

export const READ_MODES: Array<{ key: ReadMode; label: string; desc: string }> = [
  { key: 'scroll', label: 'Свиток',  desc: 'Прокрутка вниз' },
  { key: 'pages',  label: 'Страницы', desc: 'Свайп влево-вправо' },
];

export interface ReaderSettings {
  fontFamily:      FontFamilyKey;
  fontSize:        number;
  lineHeight:      number;
  textAlign:       TextAlign;
  textIndent:      number;   // em
  paragraphSpacing: number;  // em
  focusMode:       boolean;
  theme:           ReaderTheme;
  readMode:        ReadMode;
  // Сноски переводчика: по умолчанию выключено — текст сноски и так
  // лежит сразу под абзацем, тап по маркеру просто плавно подсвечивает
  // её. Когда включено — открывается всплывающая карточка над маркером
  // (удобнее на мобиле, если сноска длинная и уехала за фолд).
  footnotePopover: boolean;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontFamily: 'serif',
  fontSize: 18,
  lineHeight: 1.7,
  textAlign: 'justify',
  textIndent: 1.5,
  paragraphSpacing: 0.8,
  focusMode: false,
  theme: 'light',
  readMode: 'scroll',
  footnotePopover: false,
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
    const parsed = JSON.parse(raw) as Partial<ReaderSettings> & {
      theme?: string;
    };
    // Старые пресеты 'sepia' и 'dark' больше не поддерживаем —
    // мигрируем на light, чтобы читалка не осталась тёмной у тех,
    // кто сохранил настройку до убирания пресета.
    const theme: ReaderTheme = 'light';
    return { ...DEFAULT_SETTINGS, ...parsed, theme };
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

// Серверная синхронизация: настройки лежат в profiles.settings.reader
// (jsonb), читаются и пишутся через RPC update_my_profile (settings —
// allowlisted, см. AdultGate.tsx и SettingsForm.tsx). Источник правды
// — сервер: при mount страницу сначала восстанавливаем из localStorage
// (мгновенно), затем накатываем серверные настройки если есть.
import type { SupabaseClient } from '@supabase/supabase-js';

export async function fetchServerSettings(
  supabase: SupabaseClient
): Promise<ReaderSettings | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('profiles')
    .select('settings')
    .eq('id', user.id)
    .maybeSingle();
  const all = (data?.settings ?? {}) as Record<string, unknown>;
  const raw = all.reader as Partial<ReaderSettings> | undefined;
  if (!raw || typeof raw !== 'object') return null;
  return { ...DEFAULT_SETTINGS, ...raw, theme: 'light' };
}

export async function pushServerSettings(
  supabase: SupabaseClient,
  s: ReaderSettings
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  // Берём текущий settings jsonb, мержим reader-секцию, чтобы не
  // затереть рядом лежащие adult_confirmed_at / show_reading_publicly.
  const { data } = await supabase
    .from('profiles')
    .select('settings')
    .eq('id', user.id)
    .maybeSingle();
  const all = (data?.settings ?? {}) as Record<string, unknown>;
  const merged = { ...all, reader: s };
  await supabase.rpc('update_my_profile', {
    data_to_update: { settings: merged },
  });
}

export function getFontCss(key: FontFamilyKey): string {
  return FONT_OPTIONS.find((o) => o.key === key)?.css ?? FONT_OPTIONS[0].css;
}

// Таймер сна: доступные пресеты (мин)
export const SLEEP_TIMER_PRESETS = [15, 30, 45, 60] as const;
