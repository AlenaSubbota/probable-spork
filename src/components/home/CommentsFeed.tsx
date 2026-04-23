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

// Лента свежих комментариев на главной.
// Делаем КОМПАКТНО: одна строчка «автор → новелла · глава N · время»
// + CTA «открыть тред». Содержимое комментария на главной не
// показываем вообще — слишком высокий риск спойлера, да и длинные
// тексты раздувают блок.
export default function CommentsFeed({ comments }: Props) {
  if (comments.length === 0) return null;

  return (
    <section className="container section">
      <div className="section-head">
        <h2>О чём сейчас говорят</h2>
        <Link href="/feed" className="more">
          Вся лента →
        </Link>
      </div>

      <ul className="comments-feed-compact">
        {comments.map((c) => {
          const author = c.user_name ?? 'Читатель';
          const initial = author.trim().charAt(0).toUpperCase() || '?';
          const href = `/novel/${c.novel_firebase_id}/${c.chapter_number}#c${c.id}`;
          return (
            <li key={c.id} className="comments-feed-compact-item">
              <Link href={href} className="comments-feed-compact-link">
                <div className="comments-feed-compact-avatar" aria-hidden="true">
                  {initial}
                </div>
                <div className="comments-feed-compact-body">
                  <div className="comments-feed-compact-line">
                    <span className="comments-feed-compact-author">{author}</span>
                    <span className="comments-feed-compact-sep">·</span>
                    <span className="comments-feed-compact-novel">
                      «{c.novel_title}»
                    </span>
                    <span className="comments-feed-compact-sep">·</span>
                    <span className="comments-feed-compact-ch">
                      гл. {c.chapter_number}
                    </span>
                  </div>
                  <div className="comments-feed-compact-time">
                    {timeAgo(c.created_at)}
                  </div>
                </div>
                <span className="comments-feed-compact-arrow" aria-hidden="true">
                  →
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
