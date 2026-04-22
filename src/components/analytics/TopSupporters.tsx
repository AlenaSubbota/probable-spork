import Link from 'next/link';

export interface Supporter {
  user_id: string;
  user_name: string;
  avatar_url: string | null;
  total_coins: number;
  chapter_count: number;
}

interface Props {
  supporters: Supporter[];
  periodLabel: string;
}

// Топ-5 читателей, которые больше всех занесли монет за период.
// Переводчику важно видеть своих супер-фанов — их можно благодарить лично.
// Данные через RPC translator_top_supporters (iter 35).
export default function TopSupporters({ supporters, periodLabel }: Props) {
  if (supporters.length === 0) return null;

  const max = Math.max(...supporters.map((s) => s.total_coins));

  return (
    <section className="supporters-section">
      <div className="section-head">
        <h2>Топ читателей</h2>
        <span className="more" style={{ cursor: 'default' }}>
          за {periodLabel}
        </span>
      </div>
      <div className="supporters-list">
        {supporters.map((s, i) => {
          const pct = max > 0 ? Math.round((s.total_coins / max) * 100) : 0;
          const initial = (s.user_name ?? '?').trim().charAt(0).toUpperCase() || '?';
          return (
            <Link
              key={s.user_id}
              href={`/u/${s.user_id}`}
              className="supporter-row"
              title="Открыть профиль"
            >
              <div className="supporter-rank">#{i + 1}</div>
              <div className="supporter-avatar">
                {s.avatar_url ? (
                  <img src={s.avatar_url} alt="" />
                ) : (
                  <span>{initial}</span>
                )}
              </div>
              <div className="supporter-body">
                <div className="supporter-name">{s.user_name}</div>
                <div className="supporter-bar">
                  <span style={{ width: `${pct}%` }} />
                </div>
                <div className="supporter-meta">
                  {s.total_coins.toLocaleString('ru-RU')} монет ·{' '}
                  {s.chapter_count}{' '}
                  {pluralRu(s.chapter_count, 'глава', 'главы', 'глав')}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
      <p className="supporters-hint">
        Может, сказать им спасибо в новой главе или поделиться кусочком раньше?
      </p>
    </section>
  );
}

function pluralRu(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
