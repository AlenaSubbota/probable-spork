import Link from 'next/link';

export type BookmarkTab = 'all' | 'reading' | 'paused' | 'planned' | 'done' | 'dropped';

interface Props {
  active: BookmarkTab;
  counts: Record<BookmarkTab, number>;
}

const TABS: { key: BookmarkTab; label: string }[] = [
  { key: 'all',     label: 'Все' },
  { key: 'reading', label: 'Читаю' },
  { key: 'paused',  label: 'На паузе' },
  { key: 'planned', label: 'В планах' },
  { key: 'done',    label: 'Прочитано' },
  { key: 'dropped', label: 'Брошено' },
];

export default function BookmarkTabs({ active, counts }: Props) {
  return (
    <div className="bookmark-tabs">
      {TABS.map((t) => {
        const href = t.key === 'all' ? '/bookmarks' : `/bookmarks?tab=${t.key}`;
        const isActive = active === t.key;
        return (
          <Link
            key={t.key}
            href={href}
            className={`bookmark-tab${isActive ? ' active' : ''}`}
          >
            {t.label}
            <span className="bookmark-tab-count">{counts[t.key] ?? 0}</span>
          </Link>
        );
      })}
    </div>
  );
}
