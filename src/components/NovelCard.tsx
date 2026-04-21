import Link from 'next/link';
import { formatReadingTime } from '@/lib/catalog';

interface NovelCardProps {
  id: string;
  title: string;
  translator: string;
  metaInfo: string;
  rating: string;
  placeholderClass: string;
  placeholderText: React.ReactNode;
  flagText?: string;
  flagClass?: string;
  coverUrl?: string | null;
  chapterCount?: number | null;
}

export default function NovelCard({
  id,
  title,
  translator,
  metaInfo,
  rating,
  placeholderClass,
  placeholderText,
  flagText,
  flagClass,
  coverUrl,
  chapterCount,
}: NovelCardProps) {
  return (
    <Link href={`/novel/${id}`} className="novel-card">
      <div className="novel-cover">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={title}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div className={`placeholder ${placeholderClass}`}>
            {placeholderText}
          </div>
        )}

        <span className="rating-chip">
          <span className="star">★</span>{rating}
        </span>
        <button className="bookmark-btn" aria-label="В закладки">♥</button>
        {flagText && (
          <span className={`flag ${flagClass || ''}`}>{flagText}</span>
        )}
        {chapterCount != null && chapterCount > 0 && (
          <span className="reading-time-badge" title={`${chapterCount} глав`}>
            {formatReadingTime(chapterCount)}
          </span>
        )}
      </div>
      <div className="novel-title">{title}</div>
      <div className="novel-meta">
        <span className="by">{translator}</span> · {metaInfo}
      </div>
    </Link>
  );
}
