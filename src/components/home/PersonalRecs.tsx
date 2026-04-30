import Link from 'next/link';
import { getCoverUrl } from '@/lib/format';

export interface RecommendedNovel {
  firebase_id: string;
  title: string;
  cover_url: string | null;
  average_rating: number | null;
  match_reason: string;
}

interface Props {
  items: RecommendedNovel[];
  /** Новелла, на основе которой подобраны рекомендации (для подписи). */
  basedOnTitle: string | null;
}

// «Похоже на …» — продолжение полки «Продолжить чтение». Раньше
// рендерилось отдельной секцией с большим заголовком «Тебе должно
// зайти» и сеткой — выглядело сыро и одиноко между несвязанными
// блоками. Теперь это горизонтальная полка в том же визуальном
// языке, что и ContinueReadingShelf, с маленьким подзаголовком —
// часть единой зоны «из твоей истории».

export default function PersonalRecs({ items, basedOnTitle }: Props) {
  if (items.length === 0) return null;

  return (
    <section className="container section section-recs-tail">
      <div className="recs-tail-head">
        <span className="recs-tail-mark" aria-hidden="true">✦</span>
        <span className="recs-tail-label">
          {basedOnTitle ? (
            <>
              Похоже на «<span className="recs-tail-novel">{basedOnTitle}</span>»
            </>
          ) : (
            'Возможно, тебе зайдёт'
          )}
        </span>
      </div>

      <div className="shelf-scroll">
        {items.map((n) => {
          const cover = getCoverUrl(n.cover_url);
          return (
            <Link
              key={n.firebase_id}
              href={`/novel/${n.firebase_id}`}
              className="continue-card recs-tail-card"
            >
              <div className="mini-cover">
                {cover ? (
                  <img src={cover} alt={n.title} />
                ) : (
                  <div className="placeholder p1" style={{ fontSize: 10 }}>
                    {n.title}
                  </div>
                )}
                {n.average_rating && n.average_rating > 0 && (
                  <span className="recs-tail-rating">★ {n.average_rating.toFixed(1)}</span>
                )}
              </div>
              <div className="body">
                <div className="title">{n.title}</div>
                <div className="meta recs-tail-reason">{n.match_reason}</div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
