import type { Country } from './admin';

// Редакторские подборки: статически курируемые наборы для главной.
// Заполняются вручную, не алгоритмически — это и есть «голос редакции».
//
// Каждая подборка либо ссылается на конкретные firebase_id новелл
// (`novelIds`), либо использует «умный» фильтр по жанру/стране/настроению
// (`smartFilter`) — тогда она показывает топ N новелл по этим критериям.
//
// Карточка на главной рендерит обложки из соответствующих новелл,
// клик → /collection/[slug].

export type CollectionSmartFilter = {
  country?: Country;
  genres?: string[]; // OR
  minRating?: number;
};

export interface Collection {
  slug: string;
  title: string;
  tagline: string;
  emoji: string;
  /** Если задано — берём ровно эти новеллы по firebase_id. */
  novelIds?: string[];
  /** Иначе — выбираем топ-новеллы по этим фильтрам. */
  smartFilter?: CollectionSmartFilter;
}

export const COLLECTIONS: Collection[] = [
  {
    slug: 'cozy-east',
    title: 'Уютный Восток',
    tagline: 'Когда хочется чая, тишины и неспешного сюжета.',
    emoji: '🍵',
    smartFilter: { genres: ['Слайс', 'Повседневность', 'Школа'], minRating: 4.0 },
  },
  {
    slug: 'strong-heroines',
    title: 'С сильной героиней',
    tagline: 'Когда героиня сама ведёт сюжет, а не приложение к герою.',
    emoji: '⚔️',
    smartFilter: { genres: ['Ромфэнтези', 'Фэнтези', 'Исэкай'], minRating: 4.3 },
  },
  {
    slug: 'cultivation',
    title: 'Путь культивации',
    tagline: 'Сянься, уся, тысяча дорог к бессмертию.',
    emoji: '🐉',
    smartFilter: { country: 'cn', genres: ['Сянься', 'Уся', 'Культивация'] },
  },
  {
    slug: 'korean-romance',
    title: 'Корейская романтика',
    tagline: 'Те самые истории, которые экранизируют дорамами.',
    emoji: '💌',
    smartFilter: { country: 'kr', genres: ['Романтика', 'Ромфэнтези'], minRating: 4.2 },
  },
  {
    slug: 'one-evening',
    title: 'На один вечер',
    tagline: 'Короткие истории — до 12 глав, без затяжных пауз.',
    emoji: '🌙',
    smartFilter: { minRating: 4.2 },
  },
  {
    slug: 'completed',
    title: 'Уже дописано',
    tagline: 'Финал не разочарует — оригинал давно завершён.',
    emoji: '✦',
    smartFilter: { minRating: 4.3 },
  },
];

export function getCollection(slug: string): Collection | null {
  return COLLECTIONS.find((c) => c.slug === slug) ?? null;
}
