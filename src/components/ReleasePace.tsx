interface DayPoint {
  day: string;      // ISO date (YYYY-MM-DD)
  chapters: number;
}

interface Props {
  days: DayPoint[];   // ожидается 90 дней
  totalChapters: number;
  isCompleted: boolean;
}

// Киллер-фича #3 страницы новеллы: визуализация темпа перевода
// — столбчатая диаграмма по дням + рассчётный прогноз.
export default function ReleasePace({ days, totalChapters, isCompleted }: Props) {
  if (!days || days.length === 0) return null;

  // Считаем главы за последние 30 дней — это более актуальный сигнал, чем за 90
  const last30 = days.slice(-30);
  const chaptersLast30 = last30.reduce((sum, d) => sum + d.chapters, 0);
  const chaptersPerWeek = (chaptersLast30 / 30) * 7;

  // Максимум для масштаба графика
  const max = Math.max(1, ...days.map((d) => d.chapters));

  // День недели, в который чаще всего выходят главы (за все 90 дней)
  const weekdayMap: Record<number, number> = {};
  days.forEach((d) => {
    if (d.chapters > 0) {
      const wd = new Date(d.day).getDay();
      weekdayMap[wd] = (weekdayMap[wd] || 0) + d.chapters;
    }
  });
  const bestWeekday =
    Object.entries(weekdayMap).sort((a, b) => b[1] - a[1])[0]?.[0];
  const weekdayNames = ['воскресеньям', 'понедельникам', 'вторникам', 'средам', 'четвергам', 'пятницам', 'субботам'];

  // Прогноз
  let forecast: string;
  if (isCompleted) {
    forecast = 'Новелла завершена — все главы уже здесь.';
  } else if (chaptersLast30 === 0) {
    forecast = 'Пауза уже 30+ дней. Возможно, переводчик копит бэклог.';
  } else if (chaptersPerWeek < 0.5) {
    forecast = `Темп медленный: около ${chaptersPerWeek.toFixed(1)} гл. в неделю.`;
  } else {
    const speedLabel =
      chaptersPerWeek >= 5 ? 'стахановский' :
      chaptersPerWeek >= 2 ? 'уверенный'     :
      'размеренный';
    forecast =
      `Темп ${speedLabel}: ~${chaptersPerWeek.toFixed(1)} гл./нед.` +
      (bestWeekday !== undefined ? ` Обычно обновляется по ${weekdayNames[+bestWeekday]}.` : '');
  }

  return (
    <section className="release-pace">
      <div className="rp-head">
        <h3>Темп перевода</h3>
        <span className="rp-count">
          {chaptersLast30} гл. за 30 дней · {totalChapters} всего
        </span>
      </div>

      <div className="rp-chart" aria-label="График выхода глав за 90 дней">
        {days.map((d, i) => {
          const h = d.chapters === 0 ? 6 : Math.max(6, Math.round((d.chapters / max) * 100));
          const opacity = d.chapters === 0 ? 0.25 : 1;
          return (
            <div
              key={i}
              className="rp-bar"
              style={{ height: `${h}%`, opacity }}
              title={`${d.day}: ${d.chapters} гл.`}
            />
          );
        })}
      </div>

      <div className="rp-legend">
        <span>90 дней назад</span>
        <span>сегодня</span>
      </div>

      <p className="rp-forecast">{forecast}</p>
    </section>
  );
}
