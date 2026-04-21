// -----------------------------------------------------------
// «Настроение» — подбор по настроению вместо жанров.
// Каждое настроение маппится на набор жанров + минимальный рейтинг.
// -----------------------------------------------------------
export type MoodKey = 'cry' | 'cozy' | 'adrenaline' | 'laugh' | 'think' | 'romance';

export interface Mood {
  key: MoodKey;
  label: string;
  emoji: string;
  genres: string[];     // любое совпадение (OR)
  minRating: number;    // нижняя планка рейтинга
  tagline: string;
}

export const MOODS: Mood[] = [
  {
    key: 'cry',
    label: 'Поплакать',
    emoji: '🥺',
    genres: ['Драма', 'Трагедия', 'Психология'],
    minRating: 4.3,
    tagline: 'Те самые истории, после которых нужен вечер в тишине.',
  },
  {
    key: 'cozy',
    label: 'Уютно',
    emoji: '🍵',
    genres: ['Слайс', 'Повседневность', 'Школа', 'Сэйнэн'],
    minRating: 4.0,
    tagline: 'Чай, плед и никаких потрясений — лёгкое чтение на вечер.',
  },
  {
    key: 'adrenaline',
    label: 'Адреналин',
    emoji: '⚔️',
    genres: ['Экшен', 'Приключения', 'Боевые искусства', 'Сянься', 'Уся'],
    minRating: 4.2,
    tagline: 'Динамичные драки, квесты, ставки выше жизни.',
  },
  {
    key: 'laugh',
    label: 'Посмеяться',
    emoji: '😄',
    genres: ['Комедия', 'Пародия'],
    minRating: 4.0,
    tagline: 'Где весело даже тогда, когда всё идёт не по плану.',
  },
  {
    key: 'think',
    label: 'Подумать',
    emoji: '🧠',
    genres: ['Психология', 'Мистика', 'Детектив', 'Философия', 'Триллер'],
    minRating: 4.3,
    tagline: 'Сложные развилки и неоднозначные герои.',
  },
  {
    key: 'romance',
    label: 'Любовь',
    emoji: '💕',
    genres: ['Романтика', 'Сёдзё', 'Ромфэнтези'],
    minRating: 4.3,
    tagline: 'Когда химия важнее всего остального.',
  },
];

export function getMood(key: string | undefined): Mood | null {
  if (!key) return null;
  return MOODS.find((m) => m.key === key) ?? null;
}

// -----------------------------------------------------------
// «Время чтения» — из количества глав в часы.
// В среднем 1 глава ≈ 15 минут активного чтения.
// -----------------------------------------------------------
export type ReadingBucket = 'short' | 'evening' | 'marathon' | 'epic';

export interface ReadingBucketInfo {
  key: ReadingBucket;
  label: string;
  min: number;
  max: number;
  description: string;
}

export const READING_BUCKETS: ReadingBucketInfo[] = [
  { key: 'short',    label: 'Быстро',   min: 1,   max: 12,   description: 'до 3 часов' },
  { key: 'evening',  label: 'На вечер', min: 13,  max: 40,   description: '3–10 часов' },
  { key: 'marathon', label: 'Марафон',  min: 41,  max: 120,  description: '10–30 часов' },
  { key: 'epic',     label: 'Эпос',     min: 121, max: 9999, description: '30+ часов' },
];

export function readingBucket(chapterCount: number): ReadingBucket {
  if (chapterCount <= 12)  return 'short';
  if (chapterCount <= 40)  return 'evening';
  if (chapterCount <= 120) return 'marathon';
  return 'epic';
}

export function formatReadingTime(chapterCount: number): string {
  if (!chapterCount || chapterCount <= 0) return '—';
  const minutes = chapterCount * 15;
  if (minutes < 60) return `~${minutes} мин`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `~${hours} ч`;
  const days = Math.round(hours / 24);
  return `~${days} дн. чтения`;
}

export function getReadingBucket(key: string | undefined): ReadingBucketInfo | null {
  if (!key) return null;
  return READING_BUCKETS.find((b) => b.key === key) ?? null;
}

// -----------------------------------------------------------
// Сортировки каталога
// -----------------------------------------------------------
export type SortKey = 'rating' | 'new' | 'views' | 'alpha' | 'chapters';

export const SORT_LABELS: Record<SortKey, string> = {
  rating:   'По рейтингу',
  new:      'Свежие главы',
  views:    'Популярное',
  alpha:    'По алфавиту',
  chapters: 'Больше глав',
};

export function sortColumn(key: SortKey): { column: string; ascending: boolean } {
  switch (key) {
    case 'rating':   return { column: 'average_rating',              ascending: false };
    case 'new':      return { column: 'latest_chapter_published_at', ascending: false };
    case 'views':    return { column: 'views',                       ascending: false };
    case 'alpha':    return { column: 'title',                       ascending: true  };
    case 'chapters': return { column: 'chapter_count',               ascending: false };
  }
}

// -----------------------------------------------------------
// Утилита для построения query-string с сохранением остальных параметров
// -----------------------------------------------------------
export function buildCatalogUrl(
  current: Record<string, string | undefined>,
  patch: Record<string, string | undefined>
): string {
  const merged = { ...current, ...patch };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined && v !== '' && v !== null) params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `/catalog?${qs}` : '/catalog';
}
