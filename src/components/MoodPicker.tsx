import Link from 'next/link';
import { MOODS, type MoodKey } from '@/lib/catalog';
import { getCoverUrl } from '@/lib/format';

export interface MoodPreview {
  /** Полные URL до 3-х обложек, чтобы не дёргать обработку каждый раз. */
  covers: string[];
}

interface Props {
  activeMood?: MoodKey;
  variant?: 'hero' | 'compact';
  /** На главной — карта обложек на каждое настроение. Если не передана,
      рендерим прежний компактный вид с одним только эмодзи. */
  previews?: Record<MoodKey, MoodPreview>;
}

export default function MoodPicker({ activeMood, variant = 'hero', previews }: Props) {
  const hasPreviews = !!previews && variant === 'hero';
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
      <div className={`mood-grid${hasPreviews ? ' mood-grid-rich' : ''}`}>
        {MOODS.map((m) => {
          const isActive = activeMood === m.key;
          const preview = hasPreviews ? previews![m.key] : null;
          return (
            <Link
              key={m.key}
              href={`/catalog?mood=${m.key}`}
              className={`mood-card${isActive ? ' active' : ''}${preview ? ' mood-card-rich' : ''}`}
              title={m.tagline}
            >
              <span className="mood-card-head">
                <span className="emoji" aria-hidden="true">{m.emoji}</span>
                <span className="label">{m.label}</span>
              </span>
              {preview && preview.covers.length > 0 && (
                <span className="mood-card-covers" aria-hidden="true">
                  {preview.covers.slice(0, 3).map((url, i) => (
                    <span key={i} className={`mood-card-cover mood-card-cover-${i}`}>
                      <img src={getCoverUrl(url) ?? ''} alt="" />
                    </span>
                  ))}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
