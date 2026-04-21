import Link from 'next/link';
import { MOODS, type MoodKey } from '@/lib/catalog';

interface Props {
  activeMood?: MoodKey;
  variant?: 'hero' | 'compact';
}

export default function MoodPicker({ activeMood, variant = 'hero' }: Props) {
  return (
    <section className={variant === 'hero' ? 'container section' : undefined}>
      {variant === 'hero' && (
        <div className="section-head">
          <h2>Что почитать сегодня?</h2>
          <span className="more" style={{ cursor: 'default' }}>
            Выбери настроение
          </span>
        </div>
      )}
      <div className="mood-grid">
        {MOODS.map((m) => {
          const isActive = activeMood === m.key;
          return (
            <Link
              key={m.key}
              href={`/catalog?mood=${m.key}`}
              className={`mood-card${isActive ? ' active' : ''}`}
              title={m.tagline}
            >
              <span className="emoji" aria-hidden="true">{m.emoji}</span>
              <span className="label">{m.label}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
