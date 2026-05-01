'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

interface Invite {
  team_id: number;
  slug: string;
  name: string;
  avatar_url: string | null;
  role: string;
}

interface Props {
  invites: Invite[];
}

// Pending team invites + кнопки accept / decline.
// Миграция 078 разделила team_members на pending (accepted_at IS NULL) и
// принятых (accepted_at IS NOT NULL). Без UI юзер бы вообще не узнал, что
// его пригласили — invite_to_my_team создаёт row молча, а лидер чужой
// команды мог бы через это раньше «выдать» жертве доступ к платным главам
// своей команды. Теперь pending-state требует явного клика.
export default function TeamInvitesBlock({ invites }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (invites.length === 0) return null;

  const handleAccept = async (teamId: number) => {
    setError(null);
    setBusyId(teamId);
    const supabase = createClient();
    const { data, error: rpcErr } = await supabase.rpc('accept_team_invite', {
      p_team_id: teamId,
    });
    setBusyId(null);
    if (rpcErr) {
      setError(`Ошибка: ${rpcErr.message}`);
      return;
    }
    const r = data as { ok?: boolean; error?: string } | null;
    if (!r?.ok) {
      setError(r?.error === 'no_pending_invite'
        ? 'Приглашение уже неактуально.'
        : `Ошибка: ${r?.error ?? 'unknown'}`);
      return;
    }
    startTransition(() => router.refresh());
  };

  const handleDecline = async (teamId: number, teamName: string) => {
    setError(null);
    if (!confirm(`Отклонить приглашение в команду «${teamName}»?`)) return;
    setBusyId(teamId);
    const supabase = createClient();
    const { data, error: rpcErr } = await supabase.rpc('decline_team_invite', {
      p_team_id: teamId,
    });
    setBusyId(null);
    if (rpcErr) {
      setError(`Ошибка: ${rpcErr.message}`);
      return;
    }
    const r = data as { ok?: boolean; error?: string } | null;
    if (!r?.ok) {
      setError(`Ошибка: ${r?.error ?? 'unknown'}`);
      return;
    }
    startTransition(() => router.refresh());
  };

  return (
    <section
      className="card"
      style={{
        marginTop: 16,
        borderColor: 'var(--accent, #8b6f47)',
      }}
    >
      <h3 style={{ margin: '0 0 4px', fontFamily: 'var(--font-serif)' }}>
        {invites.length === 1
          ? 'Приглашение в команду'
          : `Приглашения в команды (${invites.length})`}
      </h3>
      <p style={{ margin: '0 0 14px', color: 'var(--ink-mute)', fontSize: 13 }}>
        Кто-то добавил тебя в свою команду. Доступ к платным главам команды
        откроется только после того, как ты согласишься.
      </p>

      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {invites.map((inv) => {
          const busy = busyId === inv.team_id || pending;
          return (
            <li
              key={inv.team_id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 12px',
                background: 'var(--bg-soft, rgba(0,0,0,0.02))',
                border: '1px solid var(--border)',
                borderRadius: 8,
              }}
            >
              {inv.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={inv.avatar_url}
                  alt=""
                  width={40}
                  height={40}
                  style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                />
              ) : (
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    background: 'var(--accent-soft, var(--accent))',
                    flexShrink: 0,
                  }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{inv.name}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
                  Роль: {translateRole(inv.role)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleAccept(inv.team_id)}
                  disabled={busy}
                >
                  {busy && busyId === inv.team_id ? '…' : 'Принять'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => handleDecline(inv.team_id, inv.name)}
                  disabled={busy}
                >
                  Отклонить
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {error && (
        <p style={{ color: 'var(--rose, #c66464)', fontSize: 13, marginTop: 10 }}>
          {error}
        </p>
      )}
    </section>
  );
}

function translateRole(role: string): string {
  switch (role) {
    case 'lead': return 'лидер';
    case 'co_translator': return 'со-переводчик';
    case 'proofreader': return 'редактор';
    case 'beta_reader': return 'бета';
    case 'other': return 'участник';
    default: return role;
  }
}
