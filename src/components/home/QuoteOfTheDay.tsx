import Link from 'next/link';

export interface QuoteItem {
  id: number;
  quote_text: string;
  chapter_number: number;
  author_name: string | null;
  novel_title: string | null;
  novel_firebase_id: string | null;
}

interface Props {
  quote: QuoteItem | null;
  /** В режиме compact компонент рендерит только саму карточку без
      обёртки section.container — для использования в сетке полосы
      из нескольких цитат на главной. */
  compact?: boolean;
}

export default function QuoteOfTheDay({ quote, compact = false }: Props) {
  if (!quote) return null;
  const target = quote.novel_firebase_id
    ? `/novel/${quote.novel_firebase_id}/${quote.chapter_number}`
    : null;

  const card = (
    <div className="quote-card">
      <div className="quote-mark" aria-hidden="true">
        ❝
      </div>
      <blockquote className="quote-text">{quote.quote_text}</blockquote>
      <div className="quote-meta">
        <span className="quote-author">
          — {quote.author_name ?? 'Читатель'}
        </span>
        {target && quote.novel_title && (
          <>
            <span className="quote-sep">·</span>
            <Link href={target} className="quote-source">
              «{quote.novel_title}», глава {quote.chapter_number}
            </Link>
          </>
        )}
      </div>
    </div>
  );

  if (compact) return card;

  return <section className="container section">{card}</section>;
}
