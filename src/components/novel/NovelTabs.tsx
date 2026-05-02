'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import './novel-tabs.css';

interface Tab {
  /** Сегмент после /novel/<id>/. '' — корень (информация о тайтле). */
  segment: string;
  label: string;
}

interface Props {
  /** firebase_id новеллы — нужен для построения href'ов табов. */
  novelFirebaseId: string;
  /** Список табов; первый с пустым segment'ом считается дефолтным. */
  tabs: Tab[];
}

// Sticky-бар табов на странице новеллы. Каждый таб — отдельный роут
// (/novel/<id>/, /novel/<id>/chapters, /novel/<id>/reviews), поэтому
// клик действительно меняет URL, но Next App Router использует client-side
// навигацию через next/link → не происходит full-page reload, шапка
// (NovelHero) переиспользуется как часть каждой страницы.
//
// Активный таб определяется через usePathname — по сегменту после
// /novel/<id>.
export default function NovelTabs({ novelFirebaseId, tabs }: Props) {
  const pathname = usePathname();

  // Извлекаем сегмент: /novel/abc → '', /novel/abc/chapters → 'chapters'
  const prefix = `/novel/${novelFirebaseId}`;
  const rest = pathname.startsWith(prefix)
    ? pathname.slice(prefix.length).replace(/^\//, '').split('/')[0] || ''
    : '';

  return (
    <div className="novel-tabs-wrap">
      <nav className="novel-tabs" aria-label="Разделы новеллы">
        {tabs.map((t) => {
          const href = t.segment ? `${prefix}/${t.segment}` : prefix;
          const isActive = rest === t.segment;
          return (
            <Link
              key={t.segment || 'root'}
              href={href}
              className={`novel-tab${isActive ? ' is-active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              prefetch
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
