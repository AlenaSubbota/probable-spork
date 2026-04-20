import Link from 'next/link';

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
  flagClass
}: NovelCardProps) {
  return (
    <Link href={`/novel/${id}`} className="novel-card">
      <div className="novel-cover">
        <div className={`placeholder ${placeholderClass}`}>
          {placeholderText}
        </div>
        <span className="rating-chip">
          <span className="star">★</span>{rating}
        </span>
        <button className="bookmark-btn" aria-label="В закладки">♥</button>
        {flagText && (
          <span className={`flag ${flagClass || ''}`}>{flagText}</span>
        )}
      </div>
      <div className="novel-title">{title}</div>
      <div className="novel-meta">
        <span className="by">{translator}</span> · {metaInfo}
      </div>
    </Link>
  );
}