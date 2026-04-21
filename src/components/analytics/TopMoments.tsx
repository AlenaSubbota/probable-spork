export interface Moment {
  icon: string;
  title: string;
  body: string;
  tone: 'positive' | 'neutral' | 'warning';
}

interface Props {
  moments: Moment[];
}

// Автоматические «находки» — короткие наблюдения, которые переводчик
// увидел бы сам, если бы покопался в цифрах, но здесь — сразу.
export default function TopMoments({ moments }: Props) {
  if (moments.length === 0) return null;

  return (
    <section className="top-moments">
      <div className="top-moments-head">
        <h3>Моменты недели</h3>
        <span className="top-moments-sub">
          Автоматические находки из твоих цифр
        </span>
      </div>
      <div className="top-moments-list">
        {moments.map((m, i) => (
          <div key={i} className={`moment moment--${m.tone}`}>
            <div className="moment-icon" aria-hidden="true">{m.icon}</div>
            <div className="moment-body">
              <div className="moment-title">{m.title}</div>
              <div className="moment-text">{m.body}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
