import Link from 'next/link';
import { timeAgo } from '@/lib/format';
import {
  readerDisplayName,
  readerProfileHref,
  type ThanksWallRow,
} from '@/lib/thanks';

interface Props {
  thanks: ThanksWallRow[];
}

// Публичная стена «писем от читателей» — бесплатные эмоциональные
// сообщения переводчику. Чаевые-с-сообщением живут отдельно в
// TributesWall (это история про монеты + текст). Здесь — чистый
// эмоциональный канал без денег.
export default function ThanksWall({ thanks }: Props) {
  if (thanks.length === 0) return null;

  return (
    <section className="thanks-wall" id="thanks-wall">
      <div className="section-head">
        <h2>
          <span className="thanks-wall-icon" aria-hidden="true">💌</span>{' '}
          Письма читателей
        </h2>
        <span className="more" style={{ cursor: 'default' }}>
          {thanks.length}
        </span>
      </div>

      <div className="thanks-wall-grid">
        {thanks.map((t) => {
          const name = readerDisplayName(t);
          const initial = name.trim().charAt(0).toUpperCase() || '?';
          const href = readerProfileHref(t);
          return (
            <article key={t.id} className="thanks-wall-card">
              <header className="thanks-wall-card-head">
                <div className="thanks-wall-card-avatar" aria-hidden="true">
                  {t.reader_avatar_url ? (
                    <img src={t.reader_avatar_url} alt="" />
                  ) : (
                    <span>{initial}</span>
                  )}
                </div>
                <div className="thanks-wall-card-head-body">
                  {href ? (
                    <Link href={href} className="thanks-wall-card-name">
                      {name}
                    </Link>
                  ) : (
                    <span className="thanks-wall-card-name">{name}</span>
                  )}
                  <div className="thanks-wall-card-context">
                    {t.novel_title && t.novel_firebase_id ? (
                      <Link
                        href={
                          t.chapter_number
                            ? `/novel/${t.novel_firebase_id}/${t.chapter_number}`
                            : `/novel/${t.novel_firebase_id}`
                        }
                        className="thanks-wall-card-novel"
                      >
                        «{t.novel_title}»
                        {t.chapter_number ? `, гл. ${t.chapter_number}` : ''}
                      </Link>
                    ) : (
                      <span className="thanks-wall-card-novel">
                        В целом, без главы
                      </span>
                    )}
                    <span className="thanks-wall-card-sep" aria-hidden="true">·</span>
                    <time className="thanks-wall-card-time">
                      {timeAgo(new Date(t.created_at))}
                    </time>
                  </div>
                </div>
              </header>
              <blockquote className="thanks-wall-card-message">
                {t.message}
              </blockquote>
            </article>
          );
        })}
      </div>
    </section>
  );
}
