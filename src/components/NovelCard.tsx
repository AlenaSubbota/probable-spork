import Link from 'next/link';
import { formatReadingTime } from '@/lib/catalog';
import { getCoverUrl } from '@/lib/format';
import NovelCoverCarousel from './NovelCoverCarousel';

interface NovelCardProps {
  id: string;
  title: string;
  translator: string;
  /** slug переводчика для ссылки /t/{slug}. Если не задан — имя остаётся span'ом. */
  translatorSlug?: string | null;
  /** Полный href для клика по подписи под обложкой. Имеет приоритет над
      translatorSlug и используется когда подпись — это автор (а не
      переводчик). Например: `/search?q=<author>` чтобы клик уводил в
      поиск по автору, а не на профиль переводчика. */
  byHref?: string | null;
  metaInfo: string;
  rating: string;
  placeholderClass: string;
  placeholderText: React.ReactNode;
  flagText?: string;
  flagClass?: string;
  coverUrl?: string | null;
  /** Дополнительные обложки (novels.covers jsonb). Если передано и
     длина > 0, карточка показывает карусель со свайпом. */
  extraCovers?: string[] | null;
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
  byHref,
  metaInfo,
  rating,
  placeholderClass,
  placeholderText,
  flagText,
  flagClass,
  coverUrl,
  extraCovers,
  chapterCount,
  description,
  genres,
  ageRating,
}: NovelCardProps) {
  // Кому уходит клик по подписи: явный byHref → /search; иначе если есть
  // translatorSlug → /t/<slug>; иначе вообще без ссылки.
  const byLinkHref =
    byHref ?? (translatorSlug ? `/t/${translatorSlug}` : null);
  const excerpt = textExcerpt(description, 200);
  const hasTooltip = !!(excerpt || (genres && genres.length > 0));
  const novelHref = `/novel/${id}`;

  // Превращаем path'ы в полные URL'ы через getCoverUrl.
  const allCovers = [
    coverUrl,
    ...((extraCovers ?? []).map((p) => getCoverUrl(p))),
  ].filter((u): u is string => !!u);
  const placeholder = (
    <div className={`placeholder ${placeholderClass}`}>{placeholderText}</div>
  );

  return (
    <div className="novel-card">
      <Link href={novelHref} className="novel-card-cover-link" aria-label={title}>
        <div className="novel-cover">
          {allCovers.length > 1 ? (
            <NovelCoverCarousel covers={allCovers} alt={title} placeholder={placeholder} />
          ) : allCovers[0] ? (
            <img
              src={allCovers[0]}
              alt={title}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            placeholder
          )}

          <span className="rating-chip">
            <span className="star">★</span>{rating}
          </span>
          {ageRating && ageRating === '18+' && (
            <span className="age-badge-card" title="Контент 18+">18+</span>
          )}

          {/* Нижняя полоска с двумя значками: FIN/free слева,
             время чтения справа. Обёрнуто в flex, чтобы на узких
             карточках бейджи не наезжали друг на друга. */}
          {(flagText || (chapterCount != null && chapterCount > 0)) && (
            <div className="novel-cover-footer">
              {flagText ? (
                <span className={`flag ${flagClass || ''}`}>{flagText}</span>
              ) : <span aria-hidden="true" />}
              {chapterCount != null && chapterCount > 0 && (
                <span className="reading-time-badge" title={`${chapterCount} глав`}>
                  {formatReadingTime(chapterCount)}
                </span>
              )}
            </div>
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
        {byLinkHref ? (
          <Link href={byLinkHref} className="by">
            {translator}
          </Link>
        ) : (
          <span className="by">{translator}</span>
        )}
        {metaInfo && (
          <>
            <span className="meta-sep" aria-hidden="true">·</span>
            <span className="meta-info">{metaInfo}</span>
          </>
        )}
      </div>
    </div>
  );
}
