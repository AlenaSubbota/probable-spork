import Link from 'next/link';
import { formatReadingTime } from '@/lib/catalog';

interface NovelCardProps {
  id: string;
  title: string;
  translator: string;
  /** slug переводчика для ссылки /t/{slug}. Если не задан — имя остаётся span'ом. */
  translatorSlug?: string | null;
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

// Карточка развёрнута: сам div не Link, чтобы внутри можно было иметь
// независимые ссылки (Next.js 16 запрещает вложенные Link). Обложка и
// заголовок ведут на новеллу; имя переводчика — на профиль переводчика,
// если передан translatorSlug.
export default function NovelCard({
  id,
  title,
  translator,
  translatorSlug,
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
  const novelHref = `/novel/${id}`;

  return (
    <div className="novel-card">
      <Link href={novelHref} className="novel-card-cover-link" aria-label={title}>
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
      </Link>
      <Link href={novelHref} className="novel-title">{title}</Link>
      <div className="novel-meta">
        {translatorSlug ? (
          <Link href={`/t/${translatorSlug}`} className="by">
            {translator}
          </Link>
        ) : (
          <span className="by">{translator}</span>
        )}
        {metaInfo && <> · {metaInfo}</>}
      </div>
    </div>
  );
}
