'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export interface StoryItem {
  id: number;
  title: string | null;
  text: string | null;
  image_url: string | null;
  bg_gradient: string | null;
  action_link: string | null;
  button_text: string | null;
  type: string | null;
  items: unknown;
}

interface Props {
  stories: StoryItem[];
}

// Instagram-style ленточка сверху: круглые аватарки с градиентом.
// По клику — модалка с картинкой + CTA (в дочитанную новеллу, в событие,
// в подборку). Данные живут в public.stories (таблица уже есть из tene).
export default function StoriesStrip({ stories }: Props) {
  const [active, setActive] = useState<StoryItem | null>(null);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActive(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active]);

  if (stories.length === 0) return null;

  return (
    <section className="container section stories-section">
      <div className="stories-strip">
        {stories.map((s) => {
          const grad =
            s.bg_gradient ||
            'linear-gradient(135deg, #FFB97A, #E85A8A, #7E5BEF)';
          return (
            <button
              key={s.id}
              type="button"
              className="stories-bubble"
              onClick={() => setActive(s)}
              aria-label={s.title ?? 'История'}
            >
              <span className="stories-ring" style={{ background: grad }}>
                <span className="stories-inner">
                  {s.image_url ? (
                    <img src={s.image_url} alt="" />
                  ) : (
                    <span className="stories-inner-letter">
                      {(s.title ?? '?').trim().charAt(0).toUpperCase()}
                    </span>
                  )}
                </span>
              </span>
              <span className="stories-label">{s.title ?? '—'}</span>
            </button>
          );
        })}
      </div>

      {active && (
        <div
          className="stories-modal"
          role="dialog"
          aria-modal="true"
          onClick={() => setActive(null)}
        >
          <div
            className="stories-modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{
              background:
                active.bg_gradient ||
                'linear-gradient(160deg, #2a1810, #5a2a3e)',
            }}
          >
            <button
              type="button"
              className="stories-modal-close"
              onClick={() => setActive(null)}
              aria-label="Закрыть"
            >
              ×
            </button>
            {active.image_url && (
              <div className="stories-modal-image">
                <img src={active.image_url} alt="" />
              </div>
            )}
            <div className="stories-modal-body">
              {active.title && (
                <h3 className="stories-modal-title">{active.title}</h3>
              )}
              {active.text && (
                <p className="stories-modal-text">{active.text}</p>
              )}
              {active.action_link && (
                <Link
                  href={active.action_link}
                  className="btn btn-primary stories-modal-cta"
                  onClick={() => setActive(null)}
                >
                  {active.button_text || 'Открыть →'}
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
