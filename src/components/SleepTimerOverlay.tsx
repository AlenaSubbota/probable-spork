'use client';

interface Props {
  onExtend: (min: number) => void;
  onDismiss: () => void;
}

// Появляется, когда таймер сна дошёл до нуля.
export default function SleepTimerOverlay({ onExtend, onDismiss }: Props) {
  return (
    <div className="sleep-overlay" role="dialog" aria-label="Таймер сна">
      <div className="sleep-card">
        <div className="sleep-moon" aria-hidden="true">🌙</div>
        <h2>Пора сделать паузу</h2>
        <p>
          Ты читаешь дольше, чем планировал_а. История никуда не денется, а глазам и сну —
          важно отдохнуть.
        </p>
        <div className="sleep-actions">
          <button type="button" className="btn btn-ghost" onClick={() => onExtend(15)}>
            Ещё 15 минут
          </button>
          <button type="button" className="btn btn-primary" onClick={onDismiss}>
            Спокойной ночи
          </button>
        </div>
      </div>
    </div>
  );
}
