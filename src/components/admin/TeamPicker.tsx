'use client';

import Link from 'next/link';

export interface PickerTeam {
  id: number;
  slug: string;
  name: string;
  avatar_url: string | null;
  member_count: number;
}

interface Props {
  /** team_id, выбранный сейчас. null — «без команды». */
  value: number | null;
  onChange: (teamId: number | null) => void;
  /** Команды, которые юзер видит как «свои» (где он лидер или член). */
  teams: PickerTeam[];
  /** Если true — даём опцию «не привязывать к команде» (только для админа
      или для случая, когда у юзера несколько команд). По умолчанию false:
      обычный переводчик ВСЕГДА должен прицеплять к своей команде. */
  allowNoTeam?: boolean;
}

// Picker команды для NovelForm. Если у юзера одна команда — это просто
// большая карточка с галочкой (она и так выбрана). Если несколько — radio
// между ними. Если ни одной — мягкая подсказка-CTA «создай команду».
export default function TeamPicker({
  value,
  onChange,
  teams,
  allowNoTeam = false,
}: Props) {
  if (teams.length === 0) {
    return (
      <div className="team-picker-empty">
        <div className="team-picker-empty-text">
          <strong>Сначала собери команду.</strong>{' '}
          Под её именем читатели будут видеть твои переводы — даже если ты
          один. Без команды новелла «висит» одиночкой, читатели не понимают,
          с кем говорят.
        </div>
        <Link href="/admin/team/new" className="btn btn-primary">
          🪶 Создать команду
        </Link>
      </div>
    );
  }

  return (
    <div className="team-picker">
      {teams.map((t) => {
        const active = value === t.id;
        return (
          <button
            type="button"
            key={t.id}
            className={`team-picker-card${active ? ' is-active' : ''}`}
            onClick={() => onChange(t.id)}
            aria-pressed={active}
          >
            <span className="team-picker-card-avatar" aria-hidden="true">
              {t.avatar_url ? (
                <img src={t.avatar_url} alt="" />
              ) : (
                <span>{t.name.slice(0, 1).toUpperCase()}</span>
              )}
            </span>
            <span className="team-picker-card-body">
              <span className="team-picker-card-name">{t.name}</span>
              <span className="team-picker-card-meta">
                /team/{t.slug} · {t.member_count}{' '}
                {pluralMembers(t.member_count)}
              </span>
            </span>
            <span className="team-picker-card-check" aria-hidden="true">
              {active ? '✓' : ''}
            </span>
          </button>
        );
      })}

      {allowNoTeam && (
        <button
          type="button"
          className={`team-picker-card team-picker-card--none${
            value === null ? ' is-active' : ''
          }`}
          onClick={() => onChange(null)}
          aria-pressed={value === null}
        >
          <span className="team-picker-card-avatar" aria-hidden="true">∅</span>
          <span className="team-picker-card-body">
            <span className="team-picker-card-name">Без команды</span>
            <span className="team-picker-card-meta">
              На карточке будет одиночный переводчик — выберешь ниже.
            </span>
          </span>
          <span className="team-picker-card-check" aria-hidden="true">
            {value === null ? '✓' : ''}
          </span>
        </button>
      )}
    </div>
  );
}

function pluralMembers(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'участник';
  if ([2, 3, 4].includes(m10) && ![12, 13, 14].includes(m100)) return 'участника';
  return 'участников';
}
