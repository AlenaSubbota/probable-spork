'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { useToasts, ToastStack } from '@/components/ui/Toast';

interface Credit {
  id: number;
  novel_id: number;
  user_id: string;
  role: string;
  share_percent: number;
  note: string | null;
  sort_order: number;
  user_name: string | null;
  avatar_url: string | null;
  translator_slug: string | null;
  display_name: string | null;
}

interface Candidate {
  id: string;
  user_name: string | null;
  avatar_url: string | null;
  translator_slug: string | null;
  translator_display_name: string | null;
}

// Роли команды — единообразно с маркетплейсом
const ROLE_META: Record<string, { label: string; emoji: string }> = {
  translator:    { label: 'Переводчик',            emoji: '🪄' },
  co_translator: { label: 'Со-переводчик',         emoji: '🤝' },
  editor:        { label: 'Редактор',              emoji: '📝' },
  proofreader:   { label: 'Корректор',             emoji: '✏️' },
  beta_reader:   { label: 'Бета-ридер',            emoji: '👁' },
  illustrator:   { label: 'Иллюстратор',           emoji: '🎨' },
  designer:      { label: 'Дизайнер',              emoji: '🎛' },
  typesetter:    { label: 'Тайпер / вёрстка',      emoji: '🔠' },
  glossary:      { label: 'Консультант-глоссарий', emoji: '🗺' },
  community:     { label: 'Комьюнити',             emoji: '💬' },
  promo_writer:  { label: 'Копирайтер промо',      emoji: '📣' },
  other:         { label: 'Другое',                emoji: '✨' },
};

const ALL_ROLES = Object.keys(ROLE_META);

interface Props {
  novelId: number;
  novelTitle: string;
  translatorId: string | null;  // текущий главный переводчик (из novels.translator_id)
}

export default function CreditsEditor({ novelId, translatorId }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const { items: toasts, push, dismiss } = useToasts();

  const [credits, setCredits] = useState<Credit[]>([]);
  const [loading, setLoading] = useState(true);

  // Форма добавления
  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [role, setRole] = useState('editor');
  const [sharePct, setSharePct] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('novel_credits')
      .select('*')
      .eq('novel_id', novelId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    setLoading(false);
    if (error) {
      push('error', `Не загрузились: ${error.message}`);
      return;
    }
    setCredits((data ?? []) as Credit[]);
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novelId]);

  // Поиск кандидатов
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      // Ищем через public_profiles (мигр. 040). profiles напрямую
      // отдаёт только свой ряд по RLS — поиск не находил никого кроме
      // себя. С public_profiles возвращаются все пользователи.
      const { data } = await supabase
        .from('public_profiles')
        .select('id, user_name, avatar_url, translator_slug, translator_display_name')
        .or(`user_name.ilike.%${q}%,translator_slug.ilike.%${q}%,translator_display_name.ilike.%${q}%`)
        .limit(8);
      if (!cancelled) setCandidates((data ?? []) as Candidate[]);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search, supabase]);

  const takenUserRoleKeys = useMemo(
    () => new Set(credits.map((c) => `${c.user_id}:${c.role}`)),
    [credits],
  );

  const handleAdd = async () => {
    if (!selected) {
      push('error', 'Выбери пользователя из списка.');
      return;
    }
    const pct = sharePct.trim() ? parseFloat(sharePct) : 0;
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      push('error', 'Доля: число от 0 до 100.');
      return;
    }
    if (takenUserRoleKeys.has(`${selected.id}:${role}`)) {
      push('error', 'Этот человек уже добавлен с этой ролью.');
      return;
    }
    setBusy(true);
    const maxSort = credits.reduce((m, c) => Math.max(m, c.sort_order), 0);
    const { error } = await supabase.from('novel_translators').insert({
      novel_id: novelId,
      user_id: selected.id,
      role,
      share_percent: pct,
      note: note.trim() || null,
      sort_order: maxSort + 1,
    });
    setBusy(false);
    if (error) {
      push('error', `Не добавилось: ${error.message}`);
      return;
    }
    push('success', 'Добавлен(а) в команду.');
    setSelected(null);
    setSearch('');
    setCandidates([]);
    setRole('editor');
    setSharePct('');
    setNote('');
    reload();
    router.refresh();
  };

  const handleRemove = async (id: number) => {
    if (!confirm('Убрать из команды?')) return;
    const { error } = await supabase.from('novel_translators').delete().eq('id', id);
    if (error) {
      push('error', error.message);
      return;
    }
    push('success', 'Удалён.');
    reload();
    router.refresh();
  };

  const handleUpdateShare = async (id: number, pct: number) => {
    if (Number.isNaN(pct) || pct < 0 || pct > 100) return;
    await supabase.from('novel_translators').update({ share_percent: pct }).eq('id', id);
    reload();
  };

  const totalShare = credits.reduce((s, c) => s + Number(c.share_percent ?? 0), 0);

  return (
    <section className="admin-form credits-editor">
      <h2 style={{ fontFamily: 'var(--font-serif)', margin: '0 0 6px' }}>
        Переводчики и команда новеллы
      </h2>
      <p style={{ color: 'var(--ink-mute)', fontSize: 13.5, margin: '0 0 14px' }}>
        Кто работает над этой новеллой. Можно добавить второго переводчика,
        редактора, корректора, иллюстратора — кого нужно. Доли % — ориентир
        для будущих выплат по главам: 0 % означает «помогает без денежного
        интереса». Сумма не обязана быть ровно 100 %, но чем дальше — тем
        запутаннее. Обычно основной переводчик берёт 60–80 %.
      </p>

      {loading ? (
        <p style={{ color: 'var(--ink-mute)' }}>Загружаем…</p>
      ) : (
        <>
          {credits.length === 0 ? (
            <div
              className="empty-state"
              style={{ padding: '14px 18px', marginBottom: 18, textAlign: 'left' }}
            >
              <p style={{ margin: 0 }}>
                Пока в команде только основной переводчик. Можно добавить
                со-переводчика, редактора, корректора, иллюстратора —
                кого угодно.
              </p>
            </div>
          ) : (
            <div className="credits-list">
              {credits.map((c) => {
                const name = c.display_name || c.user_name || '—';
                const initial = name.trim().charAt(0).toUpperCase() || '?';
                const meta = ROLE_META[c.role] ?? { label: c.role, emoji: '✨' };
                const isMainTranslator =
                  c.user_id === translatorId && c.role === 'translator';
                return (
                  <div key={c.id} className="credits-row">
                    <div className="market-card-avatar">
                      {c.avatar_url ? (
                        <img src={c.avatar_url} alt="" />
                      ) : (
                        <span>{initial}</span>
                      )}
                    </div>
                    <div className="credits-row-body">
                      <div className="credits-row-name">
                        {name}
                        {isMainTranslator && (
                          <span className="credits-main-badge" title="Основной переводчик — из карточки новеллы">
                            главный
                          </span>
                        )}
                      </div>
                      <div className="credits-row-role">
                        <span aria-hidden="true">{meta.emoji}</span> {meta.label}
                        {c.note && <span className="credits-row-note"> · {c.note}</span>}
                      </div>
                    </div>
                    <div className="credits-row-share">
                      <input
                        type="number"
                        className="form-input"
                        value={c.share_percent}
                        min={0}
                        max={100}
                        step={0.5}
                        style={{ width: 70 }}
                        onChange={(e) =>
                          setCredits((prev) =>
                            prev.map((p) =>
                              p.id === c.id
                                ? { ...p, share_percent: Number(e.target.value) }
                                : p,
                            ),
                          )
                        }
                        onBlur={(e) =>
                          handleUpdateShare(c.id, Number(e.target.value))
                        }
                      />
                      <span style={{ color: 'var(--ink-mute)' }}>%</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => handleRemove(c.id)}
                      title="Убрать из команды"
                      disabled={isMainTranslator}
                    >
                      🗑
                    </button>
                  </div>
                );
              })}
              <div className="credits-total">
                Сумма долей: <strong>{totalShare.toFixed(1)} %</strong>
                {totalShare > 100 && (
                  <span style={{ color: 'var(--rose)', marginLeft: 8 }}>
                    перебор — больше 100%
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Форма добавления */}
          <div className="credits-add">
            <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 16, margin: '0 0 10px' }}>
              Добавить в команду
            </h3>

            {selected ? (
              <div className="credits-selected">
                <div className="market-card-avatar">
                  {selected.avatar_url ? (
                    <img src={selected.avatar_url} alt="" />
                  ) : (
                    <span>{(selected.user_name ?? '?').charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>
                    {selected.translator_display_name ?? selected.user_name ?? '—'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
                    @{selected.translator_slug ?? selected.user_name ?? selected.id.slice(0, 8)}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setSelected(null)}
                >
                  Сменить
                </button>
              </div>
            ) : (
              <div className="form-field">
                <label>Кого добавить</label>
                <input
                  className="form-input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Имя пользователя или @slug"
                  autoComplete="off"
                />
                {candidates.length > 0 && (
                  <div className="credits-candidates">
                    {candidates.map((c) => {
                      const name = c.translator_display_name ?? c.user_name ?? '—';
                      const initial = name.charAt(0).toUpperCase() || '?';
                      return (
                        <button
                          type="button"
                          key={c.id}
                          className="credits-candidate"
                          onClick={() => {
                            setSelected(c);
                            setSearch('');
                            setCandidates([]);
                          }}
                        >
                          <div className="market-card-avatar">
                            {c.avatar_url ? (
                              <img src={c.avatar_url} alt="" />
                            ) : (
                              <span>{initial}</span>
                            )}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600 }}>{name}</div>
                            <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
                              @{c.translator_slug ?? c.user_name ?? c.id.slice(0, 8)}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Быстрые чипы для частых ролей — один тап вместо выбора
                из select'а. Подсвечиваем активный чип. */}
            <div className="form-field">
              <label>Роль</label>
              <div className="credits-quick-roles">
                {(['translator', 'co_translator', 'editor', 'proofreader', 'illustrator'] as const).map((r) => (
                  <button
                    type="button"
                    key={r}
                    className={`chip${role === r ? ' active' : ''}`}
                    onClick={() => setRole(r)}
                  >
                    {ROLE_META[r].emoji} {ROLE_META[r].label}
                  </button>
                ))}
              </div>
              <select
                className="form-input"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                style={{ marginTop: 6 }}
              >
                {ALL_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_META[r].emoji} {ROLE_META[r].label}
                  </option>
                ))}
              </select>
            </div>
            <div className="credits-add-row">
              <div className="form-field" style={{ flex: 1 }}></div>
              <div className="form-field" style={{ width: 100 }}>
                <label>Доля, %</label>
                <input
                  type="number"
                  className="form-input"
                  value={sharePct}
                  onChange={(e) => setSharePct(e.target.value)}
                  min={0}
                  max={100}
                  step={0.5}
                  placeholder="0"
                />
              </div>
            </div>

            <div className="form-field">
              <label>Пометка (необязательно)</label>
              <input
                className="form-input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
                placeholder="Например: «главы 1-20», «обложка», «дипломированный филолог»"
              />
            </div>

            <button
              type="button"
              className="btn btn-primary"
              onClick={handleAdd}
              disabled={busy || !selected}
            >
              {busy ? 'Добавляем…' : '＋ Добавить'}
            </button>
          </div>
        </>
      )}

      <ToastStack items={toasts} onDismiss={dismiss} />
    </section>
  );
}
