import Link from 'next/link';
import { timeAgo } from '@/lib/format';

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

// Лента свежих комментариев со всех глав. Обрезаем длинный текст и спойлеры
// Reddit-style (>!...!<) не раскрываем — показываем «•••• спойлер ••••».
function safeExcerpt(text: string, limit = 160): string {
  // Прячем спойлеры целиком
  const cleaned = text.replace(/>!([\s\S]+?)!</g, '«•••• спойлер ••••»');
  if (cleaned.length <= limit) return cleaned;
  const slice = cleaned.slice(0, limit);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > limit / 2 ? slice.slice(0, lastSpace) : slice) + '…';
}

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
        {comments.map((c) => (
          <Link
            key={c.id}
            href={`/novel/${c.novel_firebase_id}/${c.chapter_number}#c${c.id}`}
            className="comments-feed-item"
          >
            <div className="comments-feed-avatar">
              {(c.user_name ?? '?').charAt(0).toUpperCase()}
            </div>
            <div className="comments-feed-body">
              <div className="comments-feed-head">
                <span className="comments-feed-author">
                  {c.user_name ?? 'Читатель'}
                </span>
                <span className="comments-feed-time">
                  {timeAgo(c.created_at)}
                </span>
              </div>
              <p className="comments-feed-text">{safeExcerpt(c.text)}</p>
              <div className="comments-feed-where">
                «{c.novel_title}» · глава {c.chapter_number}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
