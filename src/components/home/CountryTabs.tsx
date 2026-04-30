import Link from 'next/link';

// Вкладки страны-оригинала: Корея / Китай / Япония.
// Это сигнатурная фишка ниши — на сайтах общего назначения её нет,
// у нас она вынесена в первый ряд после героя. Кликабельный переход
// в каталог с фильтром по стране.

interface Props {
  /** Если задано — соответствующая вкладка подсвечена. */
  active?: 'kr' | 'cn' | 'jp';
}

const TABS = [
  {
    code: 'kr' as const,
    flag: '🇰🇷',
    title: 'Корея',
    note: 'дорамы, ромфэнтези, школа',
  },
  {
    code: 'cn' as const,
    flag: '🇨🇳',
    title: 'Китай',
    note: 'сянься, культивация, эпос',
  },
  {
    code: 'jp' as const,
    flag: '🇯🇵',
    title: 'Япония',
    note: 'исэкай, повседневность, мистика',
  },
];

export default function CountryTabs({ active }: Props) {
  return (
    <section className="container country-tabs-wrap" aria-label="Выбор страны оригинала">
      <div className="country-tabs">
        {TABS.map((t) => {
          const isActive = active === t.code;
          return (
            <Link
              key={t.code}
              href={`/catalog?country=${t.code}`}
              className={`country-tab${isActive ? ' is-active' : ''}`}
            >
              <span className="country-tab-flag" aria-hidden="true">{t.flag}</span>
              <span className="country-tab-body">
                <span className="country-tab-title">{t.title}</span>
                <span className="country-tab-note">{t.note}</span>
              </span>
              <span className="country-tab-arrow" aria-hidden="true">→</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
