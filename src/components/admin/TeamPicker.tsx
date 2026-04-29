'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { friendlyError } from '@/lib/friendly-error';

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
// между ними. Если ни одной — inline quick-create форма с одним полем
// «Имя команды» (slug сами сгенерим из имени), чтобы новичок не рвался
// на отдельную страницу /admin/team/new и не терял прогресс по форме
// новеллы.
export default function TeamPicker({
  value,
  onChange,
  teams,
  allowNoTeam = false,
}: Props) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const slugFrom = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-zа-я0-9-\s]/gi, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30);

  const handleQuickCreate = async () => {
    setError(null);
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError('Имя команды от 2 символов.');
      return;
    }
    if (trimmed.length > 80) {
      setError('Слишком длинное имя.');
      return;
    }
    const slug = slugFrom(trimmed);
    if (slug.length < 2) {
      setError('Имя содержит только спецсимволы — добавь буквы или цифры.');
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { data, error: rpcErr } = await supabase.rpc('create_my_team', {
      p_slug: slug,
      p_name: trimmed,
    });
    setBusy(false);
    if (rpcErr) {
      setError(friendlyError(rpcErr, 'создать команду'));
      return;
    }
    const newTeamId = typeof data === 'number' ? data : null;
    if (newTeamId != null) {
      onChange(newTeamId);
      // Подтягиваем свежие данные о команде в форме сверху.
      router.refresh();
    }
    setCreating(false);
    setName('');
  };

  if (teams.length === 0) {
    return (
      <div className="team-picker-empty">
        <div className="team-picker-empty-text">
          <strong>Сначала собери команду.</strong>{' '}
          Под её именем читатели будут видеть твои переводы — даже если ты
          один. Без команды новелла «висит» одиночкой, читатели не понимают,
          с кем говорят.
        </div>
        {!creating ? (
          <div className="team-picker-empty-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setCreating(true)}
            >
              🪶 Создать команду
            </button>
            <Link href="/admin/team/new" className="btn btn-ghost">
              Подробная страница →
            </Link>
          </div>
        ) : (
          <div className="team-picker-quickcreate">
            <label className="form-label">
              Имя команды (его увидят читатели)
            </label>
            <input
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="например, «Tene Translations»"
              maxLength={80}
              autoFocus
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleQuickCreate();
                }
              }}
            />
            <p className="form-hint">
              Slug-ссылка сгенерится сама из имени:{' '}
              <code>/team/{name.trim() ? slugFrom(name) : 'имя-команды'}</code>
              . Описание, аватар и других участников можно добавить позже на
              странице команды.
            </p>
            {error && (
              <p style={{ color: 'var(--rose)', fontSize: 13, margin: '4px 0 0' }}>
                {error}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleQuickCreate}
                disabled={busy}
              >
                {busy ? 'Создаём…' : 'Создать и продолжить'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setCreating(false);
                  setError(null);
                }}
                disabled={busy}
              >
                Отмена
              </button>
            </div>
          </div>
        )}
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
