export interface ActivityDay {
  day: string;     // ISO date "2026-04-21"
  chapters: number;
}

interface Props {
  days: ActivityDay[];     // 90 дней, по возрастанию
}

// Киллер-фича #2 профиля: читательский стрик.
// Считает текущий стрик (дней подряд с активностью, включая сегодня или вчера),
// рекорд стрика и рисует 13×7 календарную heatmap за 90 дней.
export default function ReadingStreak({ days }: Props) {
  const { current, record, totalDays } = computeStreaks(days);

  // Строим 13×7 сетку (dayOfWeek → недели)
  // Берём последние 13 полных недель
  const weeks: (ActivityDay | null)[][] = [];
  if (days.length > 0) {
    const last = days[days.length - 1];
    const lastDate = new Date(last.day);
    // выравниваем к воскресенью текущей недели
    const lastWeekEnd = new Date(lastDate);
    lastWeekEnd.setDate(lastDate.getDate() + (6 - lastDate.getDay()));
    const totalWeeks = 13;
    const firstDay = new Date(lastWeekEnd);
    firstDay.setDate(lastWeekEnd.getDate() - totalWeeks * 7 + 1);

    const dayMap = new Map(days.map((d) => [d.day, d]));
    for (let w = 0; w < totalWeeks; w++) {
      const week: (ActivityDay | null)[] = [];
      for (let d = 0; d < 7; d++) {
        const dayDate = new Date(firstDay);
        dayDate.setDate(firstDay.getDate() + w * 7 + d);
        const iso = dayDate.toISOString().slice(0, 10);
        week.push(dayMap.get(iso) ?? { day: iso, chapters: 0 });
      }
      weeks.push(week);
    }
  }

  const monthNames = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  return (
    <div className="streak-card">
      <div className="streak-head">
        <div>
          <h3>Читательский стрик</h3>
          <p className="streak-sub">
            Дни подряд, когда ты открывал_а главу
          </p>
        </div>
      </div>

      <div className="streak-numbers">
        <div className="streak-num">
          <div className="streak-val">
            {current}
            <span className="streak-flame">{current >= 3 ? '🔥' : ''}</span>
          </div>
          <div className="streak-label">
            {current === 0 ? 'сегодня ещё нет активности' : pluralRu(current, 'день подряд', 'дня подряд', 'дней подряд')}
          </div>
        </div>
        <div className="streak-num">
          <div className="streak-val">{record}</div>
          <div className="streak-label">рекорд</div>
        </div>
        <div className="streak-num">
          <div className="streak-val">{totalDays}</div>
          <div className="streak-label">
            {pluralRu(totalDays, 'активный день', 'активных дня', 'активных дней')} за 90
          </div>
        </div>
      </div>

      <div className="streak-heatmap" aria-label="Календарь активности">
        {weeks.map((week, i) => (
          <div key={i} className="streak-col">
            {week.map((d, j) => {
              const level =
                !d || d.chapters === 0 ? 0 :
                d.chapters === 1 ? 1 :
                d.chapters <= 3 ? 2 :
                d.chapters <= 6 ? 3 : 4;
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
        <span>меньше</span>
        <div className="streak-cell level-0" />
        <div className="streak-cell level-1" />
        <div className="streak-cell level-2" />
        <div className="streak-cell level-3" />
        <div className="streak-cell level-4" />
        <span>больше</span>
      </div>
    </div>
  );
}

function computeStreaks(days: ActivityDay[]): { current: number; record: number; totalDays: number } {
  if (days.length === 0) return { current: 0, record: 0, totalDays: 0 };

  // Сортируем по возрастанию на всякий случай
  const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day));
  const totalDays = sorted.filter((d) => d.chapters > 0).length;

  // Рекорд — самая длинная цепочка подряд
  let record = 0;
  let run = 0;
  let prevDate: string | null = null;
  for (const d of sorted) {
    if (d.chapters > 0) {
      if (prevDate && isNextDay(prevDate, d.day)) {
        run += 1;
      } else {
        run = 1;
      }
      if (run > record) record = run;
      prevDate = d.day;
    } else {
      prevDate = null;
    }
  }

  // Текущий стрик — цепочка, оканчивающаяся сегодня или вчера
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  let current = 0;
  const rev = [...sorted].reverse();
  let streakStart: string | null = null;
  // определяем точку отсчёта
  const lastActive = rev.find((d) => d.chapters > 0);
  if (lastActive && (lastActive.day === today || lastActive.day === yesterday)) {
    streakStart = lastActive.day;
  }
  if (streakStart) {
    let cursor = streakStart;
    for (const d of rev) {
      if (d.day > cursor) continue;
      if (d.day === cursor && d.chapters > 0) {
        current += 1;
        cursor = isoMinusDay(cursor);
      } else {
        break;
      }
    }
  }

  return { current, record, totalDays };
}

function isNextDay(a: string, b: string): boolean {
  return isoMinusDay(b) === a;
}

function isoMinusDay(iso: string): string {
  const d = new Date(iso);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function pluralRu(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
