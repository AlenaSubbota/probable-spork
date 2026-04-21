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

// Тёплые «книжные» карточки-анонсы: короткие флеш-сообщения, как закладки.
// Нарочно не яркие цифровые круги — переиспользуем палитру сайта
// (кремовый/бумажный, акцентные тёплые тона). По клику модалка с CTA.
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
          const hasCover = !!s.image_url;
          return (
            <button
              key={s.id}
              type="button"
              className={`story-tile${hasCover ? ' has-cover' : ''}`}
              onClick={() => setActive(s)}
              aria-label={s.title ?? 'История'}
              style={
                !hasCover && s.bg_gradient
                  ? { background: s.bg_gradient }
                  : undefined
              }
            >
              {hasCover && (
                <span className="story-tile-cover">
                  <img src={s.image_url!} alt="" />
                  <span className="story-tile-veil" aria-hidden="true" />
                </span>
              )}
              <span className="story-tile-text">
                <span className="story-tile-title">{s.title ?? '—'}</span>
              </span>
            </button>
          );
        })}
      </div>

      {active && (
        <div
          className="story-modal"
          role="dialog"
          aria-modal="true"
          onClick={() => setActive(null)}
        >
          <div
            className="story-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="story-modal-close"
              onClick={() => setActive(null)}
              aria-label="Закрыть"
            >
              ×
            </button>
            {active.image_url ? (
              <div className="story-modal-image">
                <img src={active.image_url} alt="" />
              </div>
            ) : (
              <div
                className="story-modal-image story-modal-image--grad"
                style={{
                  background:
                    active.bg_gradient ||
                    'linear-gradient(160deg, var(--accent-soft), var(--accent))',
                }}
              >
                <span>{(active.title ?? '—').trim().charAt(0).toUpperCase()}</span>
              </div>
            )}
            <div className="story-modal-body">
              {active.title && (
                <h3 className="story-modal-title">{active.title}</h3>
              )}
              {active.text && (
                <p className="story-modal-text">{active.text}</p>
              )}
              {active.action_link && (
                <Link
                  href={active.action_link}
                  className="btn btn-primary story-modal-cta"
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
