import NovelCard from './NovelCard';
import { getCoverUrl } from '@/lib/format';

interface Novel {
  id: number;
  firebase_id: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  average_rating: number | null;
  rating_count: number | null;
  chapter_count: number | null;
  is_completed: boolean | null;
  match_count: number;
}

interface Props {
  novels: Novel[];
}

// Киллер-фича #2 страницы новеллы: рекомендации на основе реальных
// вкусов — те, кто поставил этой новелле 4+, также ставили 4+ вот этим.
export default function SimilarByReaders({ novels }: Props) {
  if (!novels || novels.length === 0) return null;

  return (
    <section className="section">
      <div className="section-head">
        <h2>Созвучие читателей</h2>
        <span className="more" style={{ cursor: 'default' }}>
          От тех, кому зашло это же
        </span>
      </div>

      <div className="novel-grid">
        {novels.map((n, index) => (
          <NovelCard
            key={n.id}
            id={n.firebase_id}
            title={n.title}
            translator={n.author || 'Алёна'}
            metaInfo={`${n.match_count} совпадений`}
            rating={n.average_rating ? Number(n.average_rating).toFixed(1) : '—'}
            coverUrl={getCoverUrl(n.cover_url)}
            placeholderClass={`p${(index % 8) + 1}`}
            placeholderText={n.title.substring(0, 14)}
            chapterCount={n.chapter_count}
            flagText={n.is_completed ? 'FIN' : undefined}
            flagClass={n.is_completed ? 'done' : undefined}
          />
        ))}
      </div>
    </section>
  );
}
