export type NewsType =
  | 'announcement'
  | 'event'
  | 'update'
  | 'tip'
  | 'maintenance'
  | 'article'
  | 'review'
  | 'interview';

// «Журнальные» типы — длинные материалы с обложкой и подзаголовком.
// Показываются отдельным блоком на главной, а не в общей ленте новостей.
export const JOURNAL_TYPES: NewsType[] = ['article', 'review', 'interview'];

export function isJournalType(t: string | null | undefined): boolean {
  return !!t && (JOURNAL_TYPES as string[]).includes(t);
}

export interface NewsTypeMeta {
  key: NewsType;
  label: string;
  emoji: string;
  tone: 'accent' | 'leaf' | 'gold' | 'rose' | 'muted';
}

export const NEWS_TYPES: NewsTypeMeta[] = [
  { key: 'announcement', label: 'Объявление', emoji: '📢', tone: 'accent' },
  { key: 'event',        label: 'Событие',    emoji: '🎉', tone: 'gold'   },
  { key: 'update',       label: 'Обновление', emoji: '⚡',  tone: 'leaf'   },
  { key: 'tip',          label: 'Совет',      emoji: '💡', tone: 'muted'  },
  { key: 'maintenance',  label: 'Тех. работы',emoji: '🔧', tone: 'rose'   },
  { key: 'article',      label: 'Статья',     emoji: '📝', tone: 'accent' },
  { key: 'review',       label: 'Обзор',      emoji: '🔎', tone: 'leaf'   },
  { key: 'interview',    label: 'Интервью',   emoji: '🎙', tone: 'gold'   },
];

export function newsTypeMeta(t: string | null | undefined): NewsTypeMeta {
  return NEWS_TYPES.find((n) => n.key === t) ?? NEWS_TYPES[0];
}
