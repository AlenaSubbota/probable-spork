import Link from 'next/link';
import { timeAgo } from '@/lib/format';
import { commentToHtml } from '@/lib/commentFormat';

export interface CommentFeedItem {
  id: number;
  user_name: string | null;
  text: string;
  created_at: string;
  novel_firebase_id: string;
  novel_title: string;
  chapter_number: number;
}

interface Props {
  comments: CommentFeedItem[];
}

// Лента свежих комментариев на главной. Текст спрятан под шторкой
// (<details>) с предупреждением о возможных спойлерах — комментарий
// вырванный из контекста главы запросто может всё испортить.
// По клику на «Показать» — текст раскрывается прямо здесь, ссылка
// на главу ведёт в полный тред.
export default function CommentsFeed({ comments }: Props) {
  if (comments.length === 0) return null;

  return (
    <section className="container section">
      <div className="section-head">
        <h2>О чём сейчас говорят</h2>
        <span className="more" style={{ cursor: 'default' }}>
          Последние {comments.length}
        </span>
      </div>

      <div className="comments-feed">
        {comments.map((c) => {
          const author = c.user_name ?? 'Читатель';
          const initial = author.trim().charAt(0).toUpperCase() || '?';
          return (
            <div key={c.id} className="comments-feed-item">
              <div className="comments-feed-avatar">{initial}</div>
              <div className="comments-feed-body">
                <div className="comments-feed-line">
                  <span className="comments-feed-author">{author}</span>
                  <span className="comments-feed-sep">→</span>
                  <Link
                    href={`/novel/${c.novel_firebase_id}`}
                    className="comments-feed-novel"
                  >
                    «{c.novel_title}»
                  </Link>
                  <span className="comments-feed-sep">·</span>
                  <Link
                    href={`/novel/${c.novel_firebase_id}/${c.chapter_number}#c${c.id}`}
                    className="comments-feed-ch"
                  >
                    гл. {c.chapter_number}
                  </Link>
                </div>

                <details className="comments-feed-spoiler">
                  <summary>
                    <span className="comments-feed-spoiler-label">
                      ⚠ Может содержать спойлеры. Показать
                    </span>
                  </summary>
                  <div
                    className="comments-feed-text"
                    dangerouslySetInnerHTML={{ __html: commentToHtml(c.text) }}
                  />
                </details>

                <div className="comments-feed-time">
                  {timeAgo(c.created_at)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
