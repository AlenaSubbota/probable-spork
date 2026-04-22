import Link from 'next/link';
import { getCoverUrl, timeAgo } from '@/lib/format';
import type { BookmarkTab } from './BookmarkTabs';
import BookmarkRemoveButton from './BookmarkRemoveButton';

export interface BookmarkItem {
  firebase_id: string;
  novel_id: number;
  title: string;
  cover_url: string | null;
  author: string | null;
  translator_slug: string | null;
  status: BookmarkTab;     // auto-derived
  chapter_count: number;
  last_chapter_read: number | null;
  last_read_at: string | null;
  fresh_chapters: number;   // count of new chapters since last read
}

interface Props {
  item: BookmarkItem;
}

export default function BookmarkCard({ item }: Props) {
  const cover = getCoverUrl(item.cover_url);
  const progressPct =
    item.chapter_count > 0 && item.last_chapter_read != null
      ? Math.min(100, Math.round((item.last_chapter_read / item.chapter_count) * 100))
      : 0;

  // Куда ведёт основная ссылка
  const resumeChapter = item.last_chapter_read
    ? Math.min(item.last_chapter_read + 1, item.chapter_count)
    : 1;
  const primaryHref =
    item.status === 'planned'
      ? `/novel/${item.firebase_id}`
      : `/novel/${item.firebase_id}/${resumeChapter || 1}`;

  // Киллер-фича #2 — подсказка о темпе для paused/dropped
  const paceHint = computePaceHint(item);

  return (
    <div className={`bookmark-card bookmark-card--${item.status}`}>
      <Link href={`/novel/${item.firebase_id}`} className="bookmark-card-cover">
        {cover ? (
          <img src={cover} alt={item.title} />
        ) : (
          <div className="placeholder p1" style={{ fontSize: 12 }}>
            {item.title}
          </div>
        )}
        {/* Киллер-фича #3 — счётчик свежих глав */}
        {item.fresh_chapters > 0 && item.status !== 'done' && (
          <div className="bookmark-fresh-badge" title={`${item.fresh_chapters} новых глав`}>
            ✨ +{item.fresh_chapters}
          </div>
        )}
      </Link>

      <div className="bookmark-card-body">
        <Link href={`/novel/${item.firebase_id}`} className="bookmark-card-title">
          {item.title}
        </Link>

        {item.author && (
          <div className="bookmark-card-author">
            {item.translator_slug ? (
              <Link href={`/t/${item.translator_slug}`}>{item.author}</Link>
            ) : (
              item.author
            )}
          </div>
        )}

        {item.status !== 'planned' && item.last_chapter_read != null && (
          <>
            <div className="bookmark-card-progress-row">
              Глава {item.last_chapter_read} из {item.chapter_count}
              <span className="bookmark-card-pct">{progressPct}%</span>
            </div>
            <div className="progress">
              <span style={{ width: `${progressPct}%` }} />
            </div>
          </>
        )}

        {item.last_read_at && (
          <div className="bookmark-card-time">
            Последний раз: {timeAgo(item.last_read_at)}
          </div>
        )}

        {paceHint && (
          <div className="bookmark-card-pace">
            {paceHint}
          </div>
        )}

        <div className="bookmark-card-actions">
          <Link href={primaryHref} className="btn btn-primary" style={{ height: 34 }}>
            {item.status === 'planned'
              ? 'Начать читать'
              : item.status === 'done'
              ? 'К новелле'
              : 'Продолжить'}
          </Link>
          <BookmarkRemoveButton firebaseId={item.firebase_id} title={item.title} />
        </div>
      </div>
    </div>
  );
}

function computePaceHint(item: BookmarkItem): string | null {
  if (item.status !== 'paused' && item.status !== 'dropped') return null;
  if (item.last_chapter_read == null || !item.chapter_count) return null;

  const left = item.chapter_count - item.last_chapter_read;
  if (left <= 0) return null;

  // Если по 2 главы в день
  const days2 = Math.ceil(left / 2);
  // Если по 5 глав
  const days5 = Math.ceil(left / 5);

  if (left <= 5) return `Осталось всего ${left} ${plural(left, 'глава', 'главы', 'глав')} — один вечер.`;
  if (left <= 20) return `Осталось ${left} глав. По 2 в день — ${days2} ${plural(days2, 'день', 'дня', 'дней')}.`;
  return `По 2 гл/день → ${days2} ${plural(days2, 'день', 'дня', 'дней')}. По 5 гл/день → ${days5} ${plural(days5, 'день', 'дня', 'дней')}.`;
}

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
