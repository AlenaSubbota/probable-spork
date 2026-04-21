interface DayPoint {
  day: string;
  chapters: number;
}

interface Props {
  days: DayPoint[];    // ~180 дней, по возрастанию
  weeksToShow?: number;
}

// Киллер-фича #2 страницы переводчика: 26-недельный heatmap выпусков.
export default function ReleaseHeatmap({ days, weeksToShow = 26 }: Props) {
  if (days.length === 0) return null;

  const dayMap = new Map(days.map((d) => [d.day, d]));
  const lastDate = new Date(days[days.length - 1].day);
  const lastWeekEnd = new Date(lastDate);
  lastWeekEnd.setDate(lastDate.getDate() + (6 - lastDate.getDay()));

  const firstDay = new Date(lastWeekEnd);
  firstDay.setDate(lastWeekEnd.getDate() - weeksToShow * 7 + 1);

  const weeks: (DayPoint | null)[][] = [];
  for (let w = 0; w < weeksToShow; w++) {
    const week: (DayPoint | null)[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(firstDay);
      date.setDate(firstDay.getDate() + w * 7 + d);
      const iso = date.toISOString().slice(0, 10);
      week.push(dayMap.get(iso) ?? { day: iso, chapters: 0 });
    }
    weeks.push(week);
  }

  const total = days.reduce((s, d) => s + d.chapters, 0);
  const activeDays = days.filter((d) => d.chapters > 0).length;

  return (
    <div className="release-heatmap">
      <div className="release-heatmap-head">
        <h3>Выпуски за полгода</h3>
        <span className="release-heatmap-sub">
          {total} {pluralRu(total, 'глава', 'главы', 'глав')} за {activeDays}{' '}
          {pluralRu(activeDays, 'день', 'дня', 'дней')}
        </span>
      </div>

      <div className="streak-heatmap" style={{ padding: '6px 0' }}>
        {weeks.map((week, i) => (
          <div key={i} className="streak-col">
            {week.map((d, j) => {
              const level =
                !d || d.chapters === 0 ? 0 :
                d.chapters === 1 ? 1 :
                d.chapters <= 2 ? 2 :
                d.chapters <= 4 ? 3 : 4;
              return (
                <div
                  key={j}
                  className={`streak-cell level-${level}`}
                  title={d ? `${d.day}: ${d.chapters} гл.` : ''}
                />
              );
            })}
          </div>
        ))}
      </div>

      <div className="streak-legend">
        <span>{formatMonth(firstDay)}</span>
        <span style={{ flex: 1 }} />
        <span>сегодня</span>
      </div>
    </div>
  );
}

function formatMonth(d: Date): string {
  const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

function pluralRu(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
