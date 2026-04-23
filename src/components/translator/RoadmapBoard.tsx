export interface RoadmapItem {
  id: number;
  title: string;
  note: string | null;
  status: 'planned' | 'in_progress' | 'completed' | 'paused';
  progress_current: number;
  progress_total: number;
}

interface Props {
  items: RoadmapItem[];
}

const STATUS_LABELS: Record<RoadmapItem['status'], { label: string; className: string; emoji: string }> = {
  in_progress: { label: 'В работе',        className: 'roadmap-status--active',    emoji: '✒️' },
  planned:     { label: 'В планах',        className: 'roadmap-status--planned',   emoji: '📚' },
  paused:      { label: 'На паузе',        className: 'roadmap-status--paused',    emoji: '☕' },
  completed:   { label: 'Закончено',       className: 'roadmap-status--done',      emoji: '✓'  },
};

// Публичный «что буду переводить» — раздел на странице переводчика.
// Социальное обязательство: читатели видят, чего ждать; переводчик
// реже бросает (не хочется снимать пункт при читателях).
export default function RoadmapBoard({ items }: Props) {
  if (items.length === 0) return null;

  const active    = items.filter((i) => i.status === 'in_progress');
  const planned   = items.filter((i) => i.status === 'planned');
  const paused    = items.filter((i) => i.status === 'paused');
  const completed = items.filter((i) => i.status === 'completed');

  return (
    <section className="roadmap-board">
      <div className="section-head">
        <h2>Планы переводчика</h2>
      </div>

      {active.length > 0 && renderGroup('in_progress', active)}
      {planned.length > 0 && renderGroup('planned', planned)}
      {paused.length > 0 && renderGroup('paused', paused)}
      {completed.length > 0 && renderGroup('completed', completed.slice(0, 6))}
    </section>
  );
}

function renderGroup(status: RoadmapItem['status'], list: RoadmapItem[]) {
  const meta = STATUS_LABELS[status];
  return (
    <div className={`roadmap-group ${meta.className}`} key={status}>
      <div className="roadmap-group-head">
        <span className="roadmap-group-emoji" aria-hidden="true">{meta.emoji}</span>
        <span className="roadmap-group-label">{meta.label}</span>
        <span className="roadmap-group-count">{list.length}</span>
      </div>
      <ul className="roadmap-list">
        {list.map((it) => {
          const pct =
            it.progress_total > 0
              ? Math.min(100, Math.round((it.progress_current / it.progress_total) * 100))
              : 0;
          return (
            <li key={it.id} className="roadmap-item">
              <div className="roadmap-item-row">
                <span className="roadmap-title">{it.title}</span>
                {it.progress_total > 0 && (
                  <span className="roadmap-progress-text">
                    {it.progress_current}/{it.progress_total}
                  </span>
                )}
              </div>
              {it.progress_total > 0 && (
                <div className="progress roadmap-progress">
                  <span style={{ width: `${pct}%` }} />
                </div>
              )}
              {it.note && <p className="roadmap-note">{it.note}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
