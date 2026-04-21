export type NewsType = 'announcement' | 'event' | 'update' | 'tip' | 'maintenance';

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
];

export function newsTypeMeta(t: string | null | undefined): NewsTypeMeta {
  return NEWS_TYPES.find((n) => n.key === t) ?? NEWS_TYPES[0];
}
