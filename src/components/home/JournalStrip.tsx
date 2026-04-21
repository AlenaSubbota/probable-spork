import Link from 'next/link';
import { newsTypeMeta } from '@/lib/news';

export interface JournalItem {
  id: number;
  title: string;
  subtitle: string | null;
  cover_url: string | null;
  type: string;
  rubrics: string[];
  published_at: string | null;
  created_at: string;
}

interface Props {
  items: JournalItem[];
}

// Блок в стиле «Литрес.Журнал»: горизонтальный слайдер из статей / обзоров /
// интервью. Каждая карточка — обложка + рубрики + заголовок. Все данные
// живут в news_posts (type in article/review/interview), чтобы не плодить
// отдельных сущностей. По клику — на страницу новости.
export default function JournalStrip({ items }: Props) {
  if (items.length === 0) return null;

  return (
    <section className="container section journal-section">
      <div className="section-head">
        <h2>Журнал: статьи, обзоры, интервью</h2>
        <Link href="/news?type=journal" className="more">
          Все материалы →
        </Link>
      </div>

      <div className="journal-strip">
        {items.map((it) => {
          const meta = newsTypeMeta(it.type);
          return (
            <Link
              key={it.id}
              href={`/news/${it.id}`}
              className="journal-card"
            >
              <div className="journal-card-cover">
                {it.cover_url ? (
                  <img src={it.cover_url} alt="" />
                ) : (
                  <div
                    className="journal-card-cover-fallback"
                    aria-hidden="true"
                  >
                    <span>{meta.emoji}</span>
                  </div>
                )}
              </div>
              <div className="journal-card-body">
                {(it.rubrics.length > 0 || it.type) && (
                  <div className="journal-card-rubrics">
                    <span className={`journal-rubric journal-rubric--${meta.tone}`}>
                      {meta.label}
                    </span>
                    {it.rubrics.slice(0, 2).map((r) => (
                      <span key={r} className="journal-rubric">
                        {r}
                      </span>
                    ))}
                  </div>
                )}
                <h3 className="journal-card-title">{it.title}</h3>
                {it.subtitle && (
                  <p className="journal-card-subtitle">{it.subtitle}</p>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
