import Link from 'next/link';
import { timeAgo, getCoverUrl } from '@/lib/format';
import { newsTypeMeta } from '@/lib/news';

export interface NewsItem {
  id: number;
  title: string;
  body: string;              // HTML
  type: string;
  is_pinned: boolean;
  created_at: string;
  published_at: string | null;
  attached_novel_id: number | null;
  attached_novel?: {
    firebase_id: string;
    title: string;
    cover_url: string | null;
  } | null;
  author_name?: string | null;
}

interface Props {
  news: NewsItem;
  compact?: boolean;
}

export default function NewsCard({ news, compact }: Props) {
  const meta = newsTypeMeta(news.type);
  const date = news.published_at ?? news.created_at;

  return (
    <article className={`news-card news-card--${meta.tone}${compact ? ' news-card--compact' : ''}`}>
      <div className="news-card-head">
        <span className="news-type">
          <span className="news-type-emoji" aria-hidden="true">{meta.emoji}</span>
          {meta.label}
        </span>
        {news.is_pinned && (
          <span className="news-pinned" title="Закреплено">📌</span>
        )}
        <time className="news-time">{timeAgo(date)}</time>
      </div>

      <h3 className="news-card-title">
        <Link href={`/news/${news.id}`}>{news.title}</Link>
      </h3>

      {!compact && (
        <div
          className="news-card-body novel-content"
          dangerouslySetInnerHTML={{ __html: news.body }}
        />
      )}

      {/* Киллер-фича #2: привязанная новелла */}
      {news.attached_novel && (
        <Link
          href={`/novel/${news.attached_novel.firebase_id}`}
          className="news-attached"
        >
          <div className="news-attached-cover">
            {news.attached_novel.cover_url ? (
              <img src={getCoverUrl(news.attached_novel.cover_url) ?? ''} alt="" />
            ) : (
              <div className="placeholder p1" style={{ fontSize: 10 }}>
                {news.attached_novel.title}
              </div>
            )}
          </div>
          <div className="news-attached-body">
            <div className="news-attached-label">О новелле</div>
            <div className="news-attached-title">{news.attached_novel.title}</div>
            <div className="news-attached-cta">Открыть →</div>
          </div>
        </Link>
      )}

      {compact && (
        <Link href={`/news/${news.id}`} className="news-card-more">
          Читать целиком →
        </Link>
      )}
    </article>
  );
}
