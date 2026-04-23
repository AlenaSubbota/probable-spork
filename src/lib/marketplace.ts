// -----------------------------------------------------------
// Константы и метаданные для маркетплейса.
// -----------------------------------------------------------

export type MarketplaceRole =
  | 'co_translator'
  | 'editor'
  | 'proofreader'
  | 'beta_reader'
  | 'illustrator'
  | 'designer'
  | 'typesetter'
  | 'glossary'
  | 'community'
  | 'promo_writer'
  | 'other';

export type Compensation =
  | 'revenue_share'
  | 'per_chapter'
  | 'fixed'
  | 'exchange'
  | 'volunteer';

export type ListingStatus = 'open' | 'in_progress' | 'closed';
export type ApplicationStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn';

export const ROLE_META: Record<
  MarketplaceRole,
  { label: string; short: string; emoji: string; description: string }
> = {
  co_translator: {
    label:       'Со-переводчик',
    short:       'Со-перевод',
    emoji:       '🪄',
    description: 'Помощник переводу — глава через главу или совместная работа.',
  },
  editor: {
    label:       'Литературный редактор',
    short:       'Редактор',
    emoji:       '📝',
    description: 'Шлифовка стиля, структуры, речи героев.',
  },
  proofreader: {
    label:       'Корректор',
    short:       'Корректор',
    emoji:       '✏️',
    description: 'Орфография, пунктуация, опечатки.',
  },
  beta_reader: {
    label:       'Бета-ридер',
    short:       'Бета',
    emoji:       '👁',
    description: 'Первый читатель — фидбек по сюжету, темпу, эмоциям.',
  },
  illustrator: {
    label:       'Иллюстратор',
    short:       'Иллюстратор',
    emoji:       '🎨',
    description: 'Обложки, вставки в главы, арты персонажей.',
  },
  designer: {
    label:       'Дизайнер',
    short:       'Дизайн',
    emoji:       '🎛',
    description: 'Баннеры, соцсетки, промо-материалы.',
  },
  typesetter: {
    label:       'Тайпер / вёрстка',
    short:       'Тайпер',
    emoji:       '🔠',
    description: 'Оформление текста в чистовик — форматирование, сноски.',
  },
  glossary: {
    label:       'Консультант по именам и терминологии',
    short:       'Глоссарий',
    emoji:       '🗺',
    description: 'Унификация имён, топонимов, названий приёмов.',
  },
  community: {
    label:       'Комьюнити-менеджер',
    short:       'Коммьюнити',
    emoji:       '💬',
    description: 'Ведение чатов, ответы читателям, модерация.',
  },
  promo_writer: {
    label:       'Копирайтер промо',
    short:       'Копирайтер',
    emoji:       '📣',
    description: 'Анонсы глав, посты в соцсети, описания для каталога.',
  },
  other: {
    label:       'Другое',
    short:       'Другое',
    emoji:       '✨',
    description: 'Свободная роль — опишет в тексте.',
  },
};

export const COMPENSATION_META: Record<Compensation, { label: string; short: string }> = {
  revenue_share: { label: '% с доходов',        short: '% дохода'     },
  per_chapter:   { label: 'За главу',           short: 'За главу'     },
  fixed:         { label: 'Фиксированная сумма', short: 'Фикс'         },
  exchange:      { label: 'Бартер / портфолио', short: 'Бартер'       },
  volunteer:     { label: 'Волонтёрство',       short: 'Волонтёр'     },
};

export const LISTING_STATUS_META: Record<ListingStatus, { label: string; className: string }> = {
  open:        { label: 'Открыто',       className: 'listing-status--open'     },
  in_progress: { label: 'В работе',      className: 'listing-status--working'  },
  closed:      { label: 'Закрыто',       className: 'listing-status--closed'   },
};

export const APP_STATUS_META: Record<ApplicationStatus, { label: string; className: string }> = {
  pending:   { label: 'На рассмотрении', className: 'app-status--pending'   },
  accepted:  { label: 'Принято',         className: 'app-status--accepted'  },
  declined:  { label: 'Отклонено',       className: 'app-status--declined'  },
  withdrawn: { label: 'Отозван',         className: 'app-status--withdrawn' },
};

export const ALL_ROLES: MarketplaceRole[] = Object.keys(ROLE_META) as MarketplaceRole[];
export const ALL_COMPENSATIONS: Compensation[] = Object.keys(COMPENSATION_META) as Compensation[];
