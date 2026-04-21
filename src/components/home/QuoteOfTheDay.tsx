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
}

// Одна случайная публичная цитата. Читатели сохраняют строки при чтении;
// если ставят галочку «показать всем» — попадает сюда. Атмосферный блок
// для главной: ощущение книжного клуба, а не магазина.
export default function QuoteOfTheDay({ quote }: Props) {
  if (!quote) return null;
  const target = quote.novel_firebase_id
    ? `/novel/${quote.novel_firebase_id}/${quote.chapter_number}`
    : null;

  return (
    <section className="container section">
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
    </section>
  );
}
