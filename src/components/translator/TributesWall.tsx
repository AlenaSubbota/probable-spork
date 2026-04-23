import Link from 'next/link';
import { timeAgo } from '@/lib/format';

export interface Tribute {
  id: number;
  from_name: string;
  from_avatar: string | null;
  message: string | null;
  tip_coins: number;
  novel_title: string;
  novel_firebase_id: string;
  chapter_number: number;
  created_at: string;
}

interface Props {
  tributes: Tribute[];
}

// «Стена благодарностей» переводчика. Показываем только те записи, где
// есть денежный тип ИЛИ текст (view translator_tributes_view сама
// фильтрует — в компоненте просто рендерим).
//
// Эмоциональное топливо для переводчика: увидеть живое «ревела весь
// вечер, спасибо» приятнее любой статистики.
export default function TributesWall({ tributes }: Props) {
  if (tributes.length === 0) return null;

  return (
    <section className="tributes-wall">
      <div className="section-head">
        <h2>Стена благодарностей</h2>
        <span className="more" style={{ cursor: 'default' }}>
          {tributes.length}
        </span>
      </div>

      <div className="tributes-grid">
        {tributes.map((t) => {
          const initial =
            (t.from_name ?? '?').trim().charAt(0).toUpperCase() || '?';
          return (
            <article key={t.id} className="tribute-card">
              <header className="tribute-head">
                <div className="tribute-avatar">
                  {t.from_avatar ? (
                    <img src={t.from_avatar} alt="" />
                  ) : (
                    <span>{initial}</span>
                  )}
                </div>
                <div className="tribute-head-body">
                  <div className="tribute-author">{t.from_name}</div>
                  <div className="tribute-context">
                    <Link
                      href={`/novel/${t.novel_firebase_id}/${t.chapter_number}`}
                      className="tribute-context-link"
                    >
                      «{t.novel_title}», гл. {t.chapter_number}
                    </Link>
                    <span className="tribute-time">· {timeAgo(t.created_at)}</span>
                  </div>
                </div>
                {t.tip_coins > 0 && (
                  <div className="tribute-coins" title="Подарил(а) монет">
                    +{t.tip_coins}
                  </div>
                )}
              </header>

              {t.message && <p className="tribute-text">{t.message}</p>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
