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
  // Опционально: краткое описание для hover-тултипа
  description?: string | null;
  genres?: string[] | null;
  ageRating?: string | null;
}

// Очищает HTML от тегов и обрезает до N символов
function textExcerpt(html: string | null | undefined, limit = 180): string {
  if (!html) return '';
  const text = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= limit) return text;
  const slice = text.slice(0, limit);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > limit / 2 ? slice.slice(0, lastSpace) : slice) + '…';
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
  description,
  genres,
  ageRating,
}: NovelCardProps) {
  const excerpt = textExcerpt(description, 200);
  const hasTooltip = !!(excerpt || (genres && genres.length > 0));

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
        {ageRating && ageRating === '18+' && (
          <span className="age-badge-card" title="Контент 18+">18+</span>
        )}
        {chapterCount != null && chapterCount > 0 && (
          <span className="reading-time-badge" title={`${chapterCount} глав`}>
            {formatReadingTime(chapterCount)}
          </span>
        )}

        {/* Hover-тултип с описанием, жанрами */}
        {hasTooltip && (
          <div className="novel-card-tooltip" role="tooltip">
            <div className="novel-card-tooltip-head">
              <span className="novel-card-tooltip-title">{title}</span>
              {ageRating && <span className="note">{ageRating}</span>}
            </div>
            {excerpt && (
              <p className="novel-card-tooltip-body">{excerpt}</p>
            )}
            {genres && genres.length > 0 && (
              <div className="novel-card-tooltip-genres">
                {genres.slice(0, 5).map((g) => (
                  <span key={g} className="novel-card-tooltip-genre">
                    {g}
                  </span>
                ))}
              </div>
            )}
            <div className="novel-card-tooltip-meta">
              <span>
                <span className="star">★</span> {rating}
              </span>
              {chapterCount != null && chapterCount > 0 && (
                <span>
                  {formatReadingTime(chapterCount)} · {chapterCount} гл.
                </span>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="novel-title">{title}</div>
      <div className="novel-meta">
        <span className="by">{translator}</span> · {metaInfo}
      </div>
    </Link>
  );
}
