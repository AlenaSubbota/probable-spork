import Link from 'next/link';

export interface StarOfTheWeekData {
  translator_id: string;
  slug: string | null;
  display_name: string;
  avatar_url: string | null;
  new_subscribers: number;
  chapters_published: number;
  coins_earned: number;
}

// Витрина на главной. Раз в минуту пересчитывается из RPC (cached на SSR).
// Если за неделю никто не набрал score > 0 — блок не рендерится.
//
// Дизайн: тёплая карточка с мягкими градиентами, без вопящего «STAR!»
// — одну строку-признание «Неделю с тобой провёл_а больше всего
// читателей», бейдж, три счётчика, ссылка на профиль.
export default function StarOfTheWeek({ data }: { data: StarOfTheWeekData | null }) {
  if (!data) return null;

  const profileHref = data.slug ? `/t/${data.slug}` : `/u/${data.translator_id}`;
  const initial = data.display_name.trim().charAt(0).toUpperCase() || '?';

  return (
    <section className="star-week">
      <div className="star-week-glow" aria-hidden="true" />
      <div className="star-week-body">
        <div className="star-week-kicker">
          <span className="star-week-star" aria-hidden="true">✦</span>
          Звезда недели
        </div>
        <h2 className="star-week-title">
          <Link href={profileHref}>{data.display_name}</Link>
        </h2>
        <p className="star-week-sub">
          Самая активная неделя в каталоге. Подписки, главы, благодарности —
          складываем и вот кто сверху.
        </p>
        <div className="star-week-stats">
          {data.new_subscribers > 0 && (
            <div className="star-week-stat">
              <span className="star-week-stat-val">+{data.new_subscribers}</span>
              <span className="star-week-stat-label">
                {data.new_subscribers === 1 ? 'подписчик' : 'подписчиков'}
              </span>
            </div>
          )}
          {data.chapters_published > 0 && (
            <div className="star-week-stat">
              <span className="star-week-stat-val">{data.chapters_published}</span>
              <span className="star-week-stat-label">
                {data.chapters_published === 1 ? 'глава' : 'глав выпущено'}
              </span>
            </div>
          )}
          {data.coins_earned > 0 && (
            <div className="star-week-stat">
              <span className="star-week-stat-val">{data.coins_earned}</span>
              <span className="star-week-stat-label">монет в копилке</span>
            </div>
          )}
        </div>
        <Link href={profileHref} className="btn btn-ghost star-week-cta">
          Открыть профиль →
        </Link>
      </div>
      <div className="star-week-portrait">
        {data.avatar_url ? (
          <img src={data.avatar_url} alt={data.display_name} />
        ) : (
          <span>{initial}</span>
        )}
      </div>
    </section>
  );
}
