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

// На главной не показываем сам текст — обсуждение читается в контексте главы,
// а одна вырванная фраза легко становится спойлером. Оставляем метаданные:
// кто, где и когда. По клику — в тред под главой.
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
            <Link
              key={c.id}
              href={`/novel/${c.novel_firebase_id}/${c.chapter_number}#c${c.id}`}
              className="comments-feed-item"
            >
              <div className="comments-feed-avatar">{initial}</div>
              <div className="comments-feed-body">
                <div className="comments-feed-line">
                  <span className="comments-feed-author">{author}</span>
                  <span className="comments-feed-sep">→</span>
                  <span className="comments-feed-novel">«{c.novel_title}»</span>
                  <span className="comments-feed-sep">·</span>
                  <span className="comments-feed-ch">
                    гл. {c.chapter_number}
                  </span>
                </div>
                <div className="comments-feed-time">
                  {timeAgo(c.created_at)}
                </div>
              </div>
              <span className="comments-feed-arrow" aria-hidden="true">
                →
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
