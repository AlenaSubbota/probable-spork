import Link from 'next/link';

export interface CreditRow {
  id: number;
  user_id: string;
  role: string;
  share_percent: number;
  note: string | null;
  user_name: string | null;
  avatar_url: string | null;
  translator_slug: string | null;
  display_name: string | null;
}

// Группы ролей для отображения. Основной переводчик всегда сверху
// (если он указан отдельной строкой в novel_translators — бэкфилл из 034).
const ROLE_META: Record<string, { label: string; emoji: string; order: number }> = {
  translator:    { label: 'Перевод',           emoji: '🪄', order: 1 },
  co_translator: { label: 'Со-перевод',        emoji: '🤝', order: 2 },
  editor:        { label: 'Редактура',         emoji: '📝', order: 3 },
  proofreader:   { label: 'Корректура',        emoji: '✏️', order: 4 },
  beta_reader:   { label: 'Бета',              emoji: '👁', order: 5 },
  glossary:      { label: 'Глоссарий',         emoji: '🗺', order: 6 },
  typesetter:    { label: 'Вёрстка',           emoji: '🔠', order: 7 },
  illustrator:   { label: 'Иллюстрации',       emoji: '🎨', order: 8 },
  designer:      { label: 'Дизайн',            emoji: '🎛', order: 9 },
  community:     { label: 'Комьюнити',         emoji: '💬', order: 10 },
  promo_writer:  { label: 'Промо',             emoji: '📣', order: 11 },
  other:         { label: 'Другое',            emoji: '✨', order: 99 },
};

interface Props {
  credits: CreditRow[];
}

// Аккуратный блок «над новеллой работают» на странице новеллы.
// Группируем по роли, внутри группы — по sort_order (уже отсортировано на SQL).
// Показываем аватарки + имена кликабельными.
export default function NovelCredits({ credits }: Props) {
  if (credits.length === 0) return null;

  // Группировка
  const groups = new Map<string, CreditRow[]>();
  for (const c of credits) {
    const arr = groups.get(c.role) ?? [];
    arr.push(c);
    groups.set(c.role, arr);
  }

  // Сортируем роли по нашему порядку
  const orderedRoles = Array.from(groups.keys()).sort((a, b) => {
    const oa = ROLE_META[a]?.order ?? 99;
    const ob = ROLE_META[b]?.order ?? 99;
    return oa - ob;
  });

  return (
    <section className="novel-credits">
      <h3 className="novel-credits-head">Над новеллой работают</h3>
      <div className="novel-credits-groups">
        {orderedRoles.map((role) => {
          const meta = ROLE_META[role] ?? { label: role, emoji: '✨' };
          const list = groups.get(role) ?? [];
          return (
            <div key={role} className="novel-credit-group">
              <div className="novel-credit-group-head">
                <span aria-hidden="true">{meta.emoji}</span>{' '}
                {meta.label}
              </div>
              <div className="novel-credit-people">
                {list.map((c) => {
                  const name = c.display_name || c.user_name || 'Переводчик';
                  const initial = name.trim().charAt(0).toUpperCase() || '?';
                  const href = c.translator_slug
                    ? `/t/${c.translator_slug}`
                    : `/u/${c.user_id}`;
                  return (
                    <Link
                      key={c.id}
                      href={href}
                      className="novel-credit-person"
                      title={c.note ?? undefined}
                    >
                      <div className="novel-credit-avatar">
                        {c.avatar_url ? (
                          <img src={c.avatar_url} alt="" />
                        ) : (
                          <span>{initial}</span>
                        )}
                      </div>
                      <span className="novel-credit-name">{name}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
