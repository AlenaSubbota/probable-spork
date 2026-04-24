import NovelCard from './NovelCard';
import { getCoverUrl } from '@/lib/format';
import type { TranslatorInfo } from '@/lib/translator';

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
  translator_id?: string | null;
}

interface Props {
  novels: Novel[];
  /** Map translator_id → {slug, name} — для подписи и кликабельного имени */
  translators?: Map<string, TranslatorInfo>;
}

// Киллер-фича #2 страницы новеллы: рекомендации на основе реальных
// вкусов — те, кто поставил этой новелле 4+, также ставили 4+ вот этим.
export default function SimilarByReaders({ novels, translators }: Props) {
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
        {novels.map((n, index) => {
          const info = n.translator_id ? translators?.get(n.translator_id) : null;
          return (
            <NovelCard
              key={n.id}
              id={n.firebase_id}
              title={n.title}
              translator={info?.name || 'Переводчик'}
              translatorSlug={info?.slug ?? null}
              metaInfo={`${n.match_count} совпадений`}
              rating={n.average_rating ? Number(n.average_rating).toFixed(1) : '—'}
              coverUrl={getCoverUrl(n.cover_url)}
              placeholderClass={`p${(index % 8) + 1}`}
              placeholderText={n.title.substring(0, 14)}
              chapterCount={n.chapter_count}
              flagText={n.is_completed ? 'FIN' : undefined}
              flagClass={n.is_completed ? 'done' : undefined}
            />
          );
        })}
      </div>
    </section>
  );
}
