import Link from 'next/link';
import { getCoverUrl } from '@/lib/format';

export interface FilmographyEntry {
  novel_id: number;
  novel_firebase_id: string;
  novel_title: string;
  cover_url: string | null;
  role: string;
  // Если переводчик был ведущим — отдельный флаг, рендерим жирнее.
  is_main_translator: boolean;
  share_percent: number | null;
  note: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  translator:    'Переводчик',
  co_translator: 'Со-переводчик',
  editor:        'Редактор',
  proofreader:   'Корректор',
  beta_reader:   'Бета',
  illustrator:   'Иллюстратор',
  designer:      'Дизайн',
  typesetter:    'Вёрстка',
  glossary:      'Глоссарий',
  community:     'Комьюнити',
  promo_writer:  'Промо',
  other:         'Другое',
};

// «Фильмография» а-ля IMDb: строка на каждое участие — даже если
// переводчик на этой новелле только корректор. Читатель видит весь
// спектр работ человека и выбирает, кого фолловить.
//
// Группировка: сначала «свои» (role='translator'), потом остальное.
// В группе «остальное» сверху те, где доля больше.
export default function TranslatorFilmography({
  entries,
}: {
  entries: FilmographyEntry[];
}) {
  if (entries.length === 0) return null;

  const mainEntries = entries.filter((e) => e.is_main_translator);
  const otherEntries = entries
    .filter((e) => !e.is_main_translator)
    .sort((a, b) => (b.share_percent ?? 0) - (a.share_percent ?? 0));

  const rolesSummary = new Map<string, number>();
  for (const e of entries) {
    rolesSummary.set(e.role, (rolesSummary.get(e.role) ?? 0) + 1);
  }

  if (mainEntries.length > 0 && otherEntries.length === 0) {
    // Классическая «все как главный переводчик» — не рендерим отдельный
    // блок, эти новеллы уже видны в секции «Все новеллы» выше на странице.
    return null;
  }

  return (
    <section className="filmography">
      <div className="filmography-head">
        <h2>Где ещё помогал_а</h2>
        <div className="filmography-summary">
          {Array.from(rolesSummary.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([role, n]) => (
              <span key={role} className="filmography-chip">
                {ROLE_LABELS[role] ?? role} · {n}
              </span>
            ))}
        </div>
      </div>

      <div className="filmography-list">
        {otherEntries.map((e) => {
          const cover = getCoverUrl(e.cover_url);
          return (
            <Link
              key={`${e.novel_id}-${e.role}`}
              href={`/novel/${e.novel_firebase_id}`}
              className="filmography-row"
            >
              <div className="filmography-cover">
                {cover ? (
                  <img src={cover} alt="" />
                ) : (
                  <div className="placeholder p1" style={{ fontSize: 9 }}>
                    {e.novel_title}
                  </div>
                )}
              </div>
              <div className="filmography-body">
                <div className="filmography-title">{e.novel_title}</div>
                <div className="filmography-role">
                  {ROLE_LABELS[e.role] ?? e.role}
                  {e.share_percent !== null && e.share_percent > 0 && (
                    <span className="filmography-share"> · {e.share_percent}%</span>
                  )}
                  {e.note && <span className="filmography-note"> · {e.note}</span>}
                </div>
              </div>
              <span className="filmography-arrow" aria-hidden="true">↗</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
