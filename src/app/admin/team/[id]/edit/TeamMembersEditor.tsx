'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { useToasts, ToastStack } from '@/components/ui/Toast';
import {
  TEAM_ROLE_INVITE_OPTIONS,
  TEAM_ROLE_LABELS,
  memberDisplayName,
  type TeamMemberRow,
  type TeamRole,
} from '@/lib/team';

interface Props {
  teamId: number;
  leaderUserId: string;
  initialMembers: TeamMemberRow[];
}

export default function TeamMembersEditor({
  teamId,
  leaderUserId,
  initialMembers,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const { items: toasts, push, dismiss } = useToasts();

  const [members, setMembers] = useState<TeamMemberRow[]>(initialMembers);
  const [handle, setHandle] = useState('');
  const [role, setRole] = useState<TeamRole>('co_translator');
  const [share, setShare] = useState<number>(0);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const { data } = await supabase
      .from('team_members_view')
      .select('*')
      .eq('team_id', teamId)
      .order('sort_order', { ascending: true });
    setMembers((data ?? []) as TeamMemberRow[]);
  };

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanHandle = handle.trim();
    if (cleanHandle.length < 2) {
      push('error', 'Введи slug или ник пользователя.');
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('invite_to_my_team', {
      p_team_id: teamId,
      p_user_handle: cleanHandle,
      p_role: role,
      p_share_percent: share,
    });
    setBusy(false);
    if (error) {
      push('error', error.message);
      return;
    }
    push('success', `Добавлен(а): ${cleanHandle}.`);
    setHandle('');
    setShare(0);
    reload();
    router.refresh();
  };

  const remove = async (memberId: number) => {
    if (!confirm('Убрать участника из команды?')) return;
    const { error } = await supabase
      .from('team_members')
      .delete()
      .eq('id', memberId);
    if (error) {
      push('error', error.message);
      return;
    }
    push('success', 'Убран(а).');
    reload();
    router.refresh();
  };

  const updateRole = async (memberId: number, newRole: TeamRole) => {
    const { error } = await supabase
      .from('team_members')
      .update({ role: newRole })
      .eq('id', memberId);
    if (error) {
      push('error', error.message);
      return;
    }
    reload();
  };

  return (
    <section className="settings-block team-members-editor">
      <h2>Участники команды</h2>
      <p className="form-hint" style={{ marginTop: -6, marginBottom: 14 }}>
        Лидера убрать нельзя — это основной владелец, на его внешние
        аккаунты идут донаты команды. Остальных можешь снять или поменять
        им роль в любой момент.
      </p>

      <div className="team-members-list">
        {members.map((m) => {
          const isLead = m.user_id === leaderUserId;
          return (
            <div
              key={m.id}
              className={`team-member-row${isLead ? ' is-lead' : ''}`}
            >
              <div className="team-member-row-avatar" aria-hidden="true">
                {m.avatar_url ? (
                  <img src={m.avatar_url} alt="" />
                ) : (
                  <span>{memberDisplayName(m).slice(0, 1).toUpperCase()}</span>
                )}
              </div>
              <div className="team-member-row-body">
                <div className="team-member-row-name">
                  {memberDisplayName(m)}
                  {isLead && <span className="team-member-row-lead-badge">лидер</span>}
                </div>
                <div className="team-member-row-handle">
                  {m.translator_slug ? `@${m.translator_slug}` : (m.user_name ?? '')}
                </div>
              </div>
              <div className="team-member-row-actions">
                {!isLead ? (
                  <>
                    <select
                      className="form-input"
                      value={m.role}
                      onChange={(e) => updateRole(m.id, e.target.value as TeamRole)}
                      style={{ height: 32, fontSize: 12, padding: '0 8px' }}
                    >
                      {TEAM_ROLE_INVITE_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {TEAM_ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => remove(m.id)}
                      style={{ height: 32, fontSize: 12 }}
                      aria-label="Убрать"
                      title="Убрать из команды"
                    >
                      🗑
                    </button>
                  </>
                ) : (
                  <span className="team-member-row-role-static">
                    {TEAM_ROLE_LABELS[m.role]}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <form onSubmit={invite} className="team-members-invite">
        <h3 className="team-members-invite-title">Пригласить участника</h3>
        <div className="form-field">
          <label htmlFor="team-handle">Slug или ник *</label>
          <input
            id="team-handle"
            type="text"
            className="form-input"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="alena или alena-pero"
            maxLength={60}
            required
          />
          <div className="form-hint">
            Введи translator_slug или user_name пользователя — мы его
            найдём и добавим. Если не знает свой slug, попроси скинуть
            ссылку на свой профиль.
          </div>
        </div>
        <div
          className="form-field"
          style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}
        >
          <div style={{ flex: '1 1 220px' }}>
            <label>Роль</label>
            <select
              className="form-input"
              value={role}
              onChange={(e) => setRole(e.target.value as TeamRole)}
            >
              {TEAM_ROLE_INVITE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {TEAM_ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: '1 1 140px' }}>
            <label>Доля, %</label>
            <input
              type="number"
              className="form-input"
              value={share}
              min={0}
              max={100}
              step={1}
              onChange={(e) => setShare(Number(e.target.value))}
            />
          </div>
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Добавляем…' : '＋ Добавить в команду'}
        </button>
      </form>

      <ToastStack items={toasts} onDismiss={dismiss} />
    </section>
  );
}
