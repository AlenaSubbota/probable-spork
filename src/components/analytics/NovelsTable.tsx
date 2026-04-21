import Link from 'next/link';

export interface NovelMetrics {
  id: number;
  firebase_id: string;
  title: string;
  total_views: number;
  rating: number | null;
  rating_count: number;
  chapters_total: number;
  chapters_period: number;
  purchases_period: number;
  subscribers_active: number;
}

interface Props {
  novels: NovelMetrics[];
  periodLabel: string;
}

// Таблица-«тепловая карта» по каждой новелле переводчика.
// Колонки раскрашены относительно самой горячей новеллы.
export default function NovelsTable({ novels, periodLabel }: Props) {
  if (novels.length === 0) return null;

  const maxViews = Math.max(1, ...novels.map((n) => n.total_views));
  const maxChapters = Math.max(1, ...novels.map((n) => n.chapters_period));
  const maxPurchases = Math.max(1, ...novels.map((n) => n.purchases_period));

  const heatLevel = (v: number, max: number) => {
    if (max === 0) return 0;
    const r = v / max;
    if (r === 0) return 0;
    if (r < 0.25) return 1;
    if (r < 0.5) return 2;
    if (r < 0.75) return 3;
    return 4;
  };

  return (
    <section className="novels-heat">
      <div className="novels-heat-head">
        <h3>Твои новеллы · {periodLabel}</h3>
      </div>
      <div className="novels-heat-scroll">
        <table className="novels-heat-table">
          <thead>
            <tr>
              <th>Новелла</th>
              <th className="num">Всего просмотров</th>
              <th className="num">Глав выпущено</th>
              <th className="num">Покупок</th>
              <th className="num">Рейтинг</th>
              <th className="num">Подписчиков</th>
            </tr>
          </thead>
          <tbody>
            {novels.map((n) => (
              <tr key={n.id}>
                <td>
                  <Link href={`/novel/${n.firebase_id}`} className="novels-heat-title">
                    {n.title}
                  </Link>
                  <div className="novels-heat-sub">{n.chapters_total} гл. всего</div>
                </td>
                <td className={`num heat heat-${heatLevel(n.total_views, maxViews)}`}>
                  {n.total_views.toLocaleString('ru-RU')}
                </td>
                <td className={`num heat heat-${heatLevel(n.chapters_period, maxChapters)}`}>
                  {n.chapters_period}
                </td>
                <td className={`num heat heat-${heatLevel(n.purchases_period, maxPurchases)}`}>
                  {n.purchases_period}
                </td>
                <td className="num">
                  {n.rating ? (
                    <>
                      <span className="star">★</span> {n.rating.toFixed(1)}
                      <span className="novels-heat-sub-inline"> ({n.rating_count})</span>
                    </>
                  ) : (
                    <span style={{ color: 'var(--ink-mute)' }}>—</span>
                  )}
                </td>
                <td className="num">
                  {n.subscribers_active > 0 ? (
                    n.subscribers_active
                  ) : (
                    <span style={{ color: 'var(--ink-mute)' }}>0</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
