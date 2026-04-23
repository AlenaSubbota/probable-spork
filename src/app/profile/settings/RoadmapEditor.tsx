'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useToasts, ToastStack } from '@/components/ui/Toast';

interface Item {
  id: number;
  translator_id?: string;
  title: string;
  note: string | null;
  status: 'planned' | 'in_progress' | 'completed' | 'paused';
  progress_current: number;
  progress_total: number;
  sort_order: number;
}

const STATUS_OPTIONS: Array<{ id: Item['status']; label: string; emoji: string }> = [
  { id: 'in_progress', label: 'В работе',    emoji: '✒️' },
  { id: 'planned',     label: 'В планах',    emoji: '📚' },
  { id: 'paused',      label: 'На паузе',    emoji: '☕' },
  { id: 'completed',   label: 'Закончено',   emoji: '✓'  },
];

interface Props {
  translatorId: string;
}

// Мини-CRUD для публичных планов переводчика. Inline-редактирование,
// дроп в статус, прогресс в паре чисел. Без перетаскивания — сортировка
// ручными кнопками «↑ / ↓» (sort_order).
export default function RoadmapEditor({ translatorId }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<Item>>({});
  const [addingTitle, setAddingTitle] = useState('');
  const { items: toasts, push: pushToast, dismiss } = useToasts();

  const supabase = createClient();

  const reload = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('translator_roadmap')
      .select('id, translator_id, title, note, status, progress_current, progress_total, sort_order')
      .eq('translator_id', translatorId)
      .order('sort_order', { ascending: true })
      .order('updated_at', { ascending: false });
    setLoading(false);
    if (error) {
      pushToast('error', `Не загрузилось: ${error.message}`);
      return;
    }
    setItems((data ?? []) as Item[]);
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translatorId]);

  const addNew = async () => {
    const title = addingTitle.trim();
    if (!title) return;
    const maxSort = items.reduce((m, i) => Math.max(m, i.sort_order), 0);
    const { error } = await supabase.from('translator_roadmap').insert({
      translator_id: translatorId,
      title,
      status: 'planned',
      sort_order: maxSort + 1,
    });
    if (error) {
      pushToast('error', `Не добавилось: ${error.message}`);
      return;
    }
    setAddingTitle('');
    pushToast('success', 'Добавлено.');
    reload();
  };

  const startEdit = (it: Item) => {
    setEditingId(it.id);
    setDraft({
      title: it.title,
      note: it.note ?? '',
      status: it.status,
      progress_current: it.progress_current,
      progress_total: it.progress_total,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft({});
  };

  const saveEdit = async (id: number) => {
    if (!draft.title || !draft.title.trim()) return;
    const { error } = await supabase
      .from('translator_roadmap')
      .update({
        title: draft.title.trim(),
        note: draft.note?.trim() || null,
        status: draft.status ?? 'planned',
        progress_current: Math.max(0, Number(draft.progress_current) || 0),
        progress_total: Math.max(0, Number(draft.progress_total) || 0),
      })
      .eq('id', id);
    if (error) {
      pushToast('error', `Не сохранилось: ${error.message}`);
      return;
    }
    pushToast('success', 'Сохранено.');
    cancelEdit();
    reload();
  };

  const remove = async (id: number) => {
    if (!confirm('Удалить из плана?')) return;
    const { error } = await supabase.from('translator_roadmap').delete().eq('id', id);
    if (error) {
      pushToast('error', error.message);
      return;
    }
    reload();
  };

  const move = async (id: number, dir: -1 | 1) => {
    const idx = items.findIndex((i) => i.id === id);
    const neigh = items[idx + dir];
    if (idx < 0 || !neigh) return;
    const me = items[idx];
    // Меняем sort_order парой
    await supabase
      .from('translator_roadmap')
      .update({ sort_order: neigh.sort_order })
      .eq('id', me.id);
    await supabase
      .from('translator_roadmap')
      .update({ sort_order: me.sort_order })
      .eq('id', neigh.id);
    reload();
  };

  return (
    <section className="settings-block">
      <h2>Мои планы переводчика</h2>
      <p style={{ color: 'var(--ink-mute)', fontSize: 13.5, marginTop: -8, marginBottom: 14 }}>
        Публичный список «что буду переводить». Виден на твоей странице <code>/t/slug</code>.
      </p>

      <div className="roadmap-add">
        <input
          className="form-input"
          type="text"
          placeholder="Название новеллы / проекта"
          value={addingTitle}
          onChange={(e) => setAddingTitle(e.target.value)}
          maxLength={200}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addNew();
            }
          }}
        />
        <button
          type="button"
          className="btn btn-primary"
          onClick={addNew}
          disabled={!addingTitle.trim()}
        >
          ＋ Добавить
        </button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--ink-mute)', fontSize: 13 }}>Загружаем…</p>
      ) : items.length === 0 ? (
        <p style={{ color: 'var(--ink-mute)', fontSize: 13 }}>
          Пока пусто. Добавь первый проект — читатели будут видеть, чего ждать.
        </p>
      ) : (
        <ul className="roadmap-editor-list">
          {items.map((it, idx) => {
            const editing = editingId === it.id;
            return (
              <li key={it.id} className="roadmap-editor-item">
                {editing ? (
                  <div className="roadmap-editor-edit">
                    <input
                      className="form-input"
                      value={draft.title ?? ''}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                      placeholder="Название"
                      maxLength={200}
                    />
                    <textarea
                      className="form-textarea"
                      rows={2}
                      maxLength={500}
                      value={(draft.note as string) ?? ''}
                      onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                      placeholder="Заметка (необязательно)"
                    />
                    <div className="roadmap-editor-row">
                      <select
                        className="form-input"
                        value={draft.status ?? 'planned'}
                        onChange={(e) =>
                          setDraft({ ...draft, status: e.target.value as Item['status'] })
                        }
                        style={{ maxWidth: 180 }}
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.emoji} {s.label}
                          </option>
                        ))}
                      </select>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>Прогресс</span>
                        <input
                          type="number"
                          className="form-input"
                          min={0}
                          style={{ width: 80 }}
                          value={draft.progress_current ?? 0}
                          onChange={(e) =>
                            setDraft({ ...draft, progress_current: Number(e.target.value) })
                          }
                        />
                        <span style={{ color: 'var(--ink-mute)' }}>/</span>
                        <input
                          type="number"
                          className="form-input"
                          min={0}
                          style={{ width: 80 }}
                          value={draft.progress_total ?? 0}
                          onChange={(e) =>
                            setDraft({ ...draft, progress_total: Number(e.target.value) })
                          }
                        />
                        <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>глав</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => saveEdit(it.id)}
                      >
                        Сохранить
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={cancelEdit}
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="roadmap-editor-view">
                    <div className="roadmap-editor-view-body">
                      <div className="roadmap-editor-title">
                        <span className="roadmap-editor-emoji" aria-hidden="true">
                          {STATUS_OPTIONS.find((s) => s.id === it.status)?.emoji}
                        </span>
                        {it.title}
                      </div>
                      <div className="roadmap-editor-meta">
                        {STATUS_OPTIONS.find((s) => s.id === it.status)?.label}
                        {it.progress_total > 0 && (
                          <>
                            {' · '}
                            {it.progress_current}/{it.progress_total} глав
                          </>
                        )}
                      </div>
                      {it.note && (
                        <div className="roadmap-editor-note">{it.note}</div>
                      )}
                    </div>
                    <div className="roadmap-editor-actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => move(it.id, -1)}
                        disabled={idx === 0}
                        title="Выше"
                        aria-label="Выше"
                      >↑</button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => move(it.id, 1)}
                        disabled={idx === items.length - 1}
                        title="Ниже"
                        aria-label="Ниже"
                      >↓</button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => startEdit(it)}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => remove(it.id)}
                        title="Удалить"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ToastStack items={toasts} onDismiss={dismiss} />
    </section>
  );
}
