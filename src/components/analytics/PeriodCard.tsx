interface Props {
  label: string;
  value: number | string;
  prev: number | null;    // null если сравнения нет
  suffix?: string;
  formatter?: (n: number) => string;
  hint?: string;
}

// Карточка с метрикой и сравнением с прошлым периодом.
export default function PeriodCard({
  label,
  value,
  prev,
  suffix,
  formatter,
  hint,
}: Props) {
  const num = typeof value === 'number' ? value : 0;
  const fmt = formatter ?? ((n: number) => n.toLocaleString('ru-RU'));

  let diffPct: number | null = null;
  let diffAbs = 0;
  if (prev !== null && prev > 0) {
    diffPct = Math.round(((num - prev) / prev) * 100);
    diffAbs = num - prev;
  } else if (prev === 0 && num > 0) {
    diffPct = null; // «+∞» показываем отдельно
    diffAbs = num;
  }

  const direction =
    diffPct === null && prev === 0 && num > 0
      ? 'up'
      : diffPct === null
      ? 'flat'
      : diffPct > 0
      ? 'up'
      : diffPct < 0
      ? 'down'
      : 'flat';

  return (
    <div className={`period-card period-card--${direction}`}>
      <div className="period-card-label">{label}</div>
      <div className="period-card-value">
        {typeof value === 'number' ? fmt(num) : value}
        {suffix && <span className="period-card-suffix">{suffix}</span>}
      </div>
      {prev !== null && (
        <div className="period-card-diff">
          {direction === 'up' && <>▲ </>}
          {direction === 'down' && <>▼ </>}
          {direction === 'flat' && <>— </>}
          {diffPct !== null ? (
            <>
              {diffPct > 0 ? '+' : ''}{diffPct}%
              <span className="period-card-diff-abs">
                ({diffAbs > 0 ? '+' : ''}{diffAbs})
              </span>
            </>
          ) : prev === 0 && num > 0 ? (
            <>+{num} (с нуля)</>
          ) : (
            <>без изменений</>
          )}
        </div>
      )}
      {hint && <div className="period-card-hint">{hint}</div>}
    </div>
  );
}
