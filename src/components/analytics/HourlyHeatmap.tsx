'use client';

import { useMemo } from 'react';

export interface HeatmapCell {
  dow: number;   // 0=Пн..6=Вс
  hour: number;  // 0..23 (сервер присылает UTC)
  reads: number;
}

const DOW_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// Тепловая карта «когда читают твои новеллы». Сервер отдаёт агрегат
// в UTC; при рендере ровно один раз сдвигаем по локальной TZ клиента
// (useMemo от самого cells), чтобы 9:00 утра для автора в Мск смотрелось
// как 9:00, а не как 6:00.
//
// Цвет: 5 уровней от бежевого к акцентному. Максимум — 1.0.
// Подсказки: ховер на ячейку → «Вт 14:00 · 23 открытия».
export default function HourlyHeatmap({ cells }: { cells: HeatmapCell[] }) {
  const { matrix, maxVal, suggested } = useMemo(() => {
    // Сдвиг из UTC в локаль браузера
    const offsetMin = new Date().getTimezoneOffset(); // мин между UTC и локалью (Мск=-180)
    const offsetHours = -offsetMin / 60; // для Мск = +3

    // matrix[dow][hour] = reads
    const m: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    let max = 0;
    for (const c of cells) {
      const localHour = (c.hour + offsetHours + 24) % 24;
      // При смещении через полночь сдвигаем и день недели на ±1.
      let localDow = c.dow;
      if (c.hour + offsetHours >= 24) localDow = (c.dow + 1) % 7;
      else if (c.hour + offsetHours < 0) localDow = (c.dow + 6) % 7;
      m[localDow][Math.floor(localHour)] += c.reads;
      if (m[localDow][Math.floor(localHour)] > max) {
        max = m[localDow][Math.floor(localHour)];
      }
    }

    // Рекомендация: топ-3 горячих слота (dow × hour)
    const flat: Array<{ dow: number; hour: number; reads: number }> = [];
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        if (m[d][h] > 0) flat.push({ dow: d, hour: h, reads: m[d][h] });
      }
    }
    flat.sort((a, b) => b.reads - a.reads);
    const sugg = flat.slice(0, 3);

    return { matrix: m, maxVal: max, suggested: sugg };
  }, [cells]);

  if (maxVal === 0) {
    return (
      <div className="empty-state">
        <p>
          За последние 30 дней недостаточно открытий, чтобы построить карту.
          Загляни сюда после того, как несколько читателей прочтут твои главы.
        </p>
      </div>
    );
  }

  const levelFor = (n: number) => {
    if (n === 0) return 0;
    const r = n / maxVal;
    if (r < 0.15) return 1;
    if (r < 0.35) return 2;
    if (r < 0.65) return 3;
    return 4;
  };

  const hourLabels = [0, 3, 6, 9, 12, 15, 18, 21];

  return (
    <div className="hh-block">
      <div className="hh-head">
        <h3>Когда твоих читают</h3>
        <p>
          Последние 30 дней, часы в твоей зоне. Публикуй главу ближе
          к пиковому слоту — её сразу увидят.
        </p>
      </div>

      {suggested.length > 0 && (
        <div className="hh-suggested">
          <span className="hh-suggested-kicker">лучшие слоты</span>
          {suggested.map((s, i) => (
            <span key={`${s.dow}-${s.hour}`} className="hh-suggested-pill">
              {i === 0 && '★ '}
              {DOW_LABELS[s.dow]} · {String(s.hour).padStart(2, '0')}:00
              <span className="hh-suggested-val"> · {s.reads}</span>
            </span>
          ))}
        </div>
      )}

      <div className="hh-grid-wrap">
        <div className="hh-grid">
          <div className="hh-corner" />
          {hourLabels.map((h) => (
            <div
              key={h}
              className="hh-hour-label"
              style={{ gridColumn: `${h + 2} / span 1` }}
            >
              {String(h).padStart(2, '0')}
            </div>
          ))}

          {DOW_LABELS.map((lbl, dow) => (
            <div key={`row-${dow}`} className="hh-row-label" style={{ gridRow: `${dow + 2} / span 1` }}>
              {lbl}
            </div>
          ))}

          {matrix.flatMap((row, dow) =>
            row.map((val, hour) => {
              const lvl = levelFor(val);
              return (
                <div
                  key={`${dow}-${hour}`}
                  className={`hh-cell hh-cell--${lvl}`}
                  style={{
                    gridColumn: `${hour + 2} / span 1`,
                    gridRow: `${dow + 2} / span 1`,
                  }}
                  title={
                    val > 0
                      ? `${DOW_LABELS[dow]} ${String(hour).padStart(2, '0')}:00 · ${val} ${val === 1 ? 'открытие' : 'открытий'}`
                      : `${DOW_LABELS[dow]} ${String(hour).padStart(2, '0')}:00 · тихо`
                  }
                />
              );
            })
          )}
        </div>
      </div>

      <div className="hh-legend">
        <span>мало</span>
        <div className="hh-cell hh-cell--1" />
        <div className="hh-cell hh-cell--2" />
        <div className="hh-cell hh-cell--3" />
        <div className="hh-cell hh-cell--4" />
        <span>пик</span>
      </div>
    </div>
  );
}
