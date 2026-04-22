'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { useToasts, ToastStack } from '@/components/ui/Toast';

export interface PollOptionFormValue {
  id?: number;
  title: string;
  description: string;
  cover_url: string;
  external_link: string;
  sort_order: number;
}

export interface PollFormValues {
  id?: number;
  title: string;
  description: string;
  is_active: boolean;
  ends_at: string | null; // ISO local (datetime-local)
  options: PollOptionFormValue[];
}

interface Props {
  initial?: PollFormValues;
  mode: 'create' | 'edit';
}

const EMPTY: PollFormValues = {
  title: '',
  description: '',
  is_active: true,
  ends_at: null,
  options: [blankOption(0), blankOption(1)],
};

function blankOption(sort: number): PollOptionFormValue {
  return {
    title: '',
    description: '',
    cover_url: '',
    external_link: '',
    sort_order: sort,
  };
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // YYYY-MM-DDTHH:mm в локальной TZ
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    '-' +
    pad(d.getMonth() + 1) +
    '-' +
    pad(d.getDate()) +
    'T' +
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes())
  );
}

export default function PollForm({ initial, mode }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<PollFormValues>(
    () => initial ?? EMPTY
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { items: toasts, push: pushToast, dismiss: dismissToast } = useToasts();

  const set = <K extends keyof PollFormValues>(k: K, v: PollFormValues[K]) =>
    setValues((p) => ({ ...p, [k]: v }));

  const updateOption = (i: number, patch: Partial<PollOptionFormValue>) => {
    setValues((p) => ({
      ...p,
      options: p.options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)),
    }));
  };

  const addOption = () =>
    setValues((p) => ({
      ...p,
      options: [...p.options, blankOption(p.options.length)],
    }));

  const removeOption = (i: number) => {
    setValues((p) => ({
      ...p,
      options: p.options.filter((_, idx) => idx !== i),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!values.title.trim()) {
      setError('Укажи вопрос опроса.');
      return;
    }
    const validOptions = values.options.filter((o) => o.title.trim().length > 0);
    if (validOptions.length < 2) {
      setError('Нужно минимум два варианта.');
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError('Нужна авторизация.');
      setSubmitting(false);
      return;
    }

    const endsAtIso =
      values.ends_at && values.ends_at.trim()
        ? new Date(values.ends_at).toISOString()
        : null;

    const pollPayload = {
      title: values.title.trim(),
      description: values.description.trim() || null,
      is_active: values.is_active,
      ends_at: endsAtIso,
    };

    let pollId = values.id;

    if (mode === 'create') {
      const { data, error: insErr } = await supabase
        .from('polls')
        .insert({ ...pollPayload, author_id: user.id })
        .select('id')
        .single();
      if (insErr || !data) {
        const msg = insErr?.message ?? 'Не удалось создать опрос.';
        setError(msg);
        pushToast('error', msg);
        setSubmitting(false);
        return;
      }
      pollId = data.id;
    } else {
      const { error: upErr } = await supabase
        .from('polls')
        .update(pollPayload)
        .eq('id', values.id!);
      if (upErr) {
        setError(upErr.message);
        pushToast('error', `Не сохранилось: ${upErr.message}`);
        setSubmitting(false);
        return;
      }
    }

    // Синхронизируем опции: удаляем снятые, обновляем существующие, вставляем новые
    if (mode === 'edit' && values.id) {
      const existingIds = validOptions
        .map((o) => o.id)
        .filter((x): x is number => !!x);
      if (existingIds.length > 0) {
        await supabase
          .from('poll_options')
          .delete()
          .eq('poll_id', values.id)
          .not('id', 'in', `(${existingIds.join(',')})`);
      } else {
        await supabase.from('poll_options').delete().eq('poll_id', values.id);
      }
    }

    for (let i = 0; i < validOptions.length; i++) {
      const o = validOptions[i];
      const optPayload = {
        poll_id: pollId!,
        title: o.title.trim(),
        description: o.description.trim() || null,
        cover_url: o.cover_url.trim() || null,
        external_link: o.external_link.trim() || null,
        sort_order: i,
      };
      if (o.id) {
        const { error: upErr } = await supabase
          .from('poll_options')
          .update(optPayload)
          .eq('id', o.id);
        if (upErr) {
          setError(upErr.message);
          setSubmitting(false);
          return;
        }
      } else {
        const { error: insErr } = await supabase
          .from('poll_options')
          .insert(optPayload);
        if (insErr) {
          setError(insErr.message);
          setSubmitting(false);
          return;
        }
      }
    }

    pushToast(
      'success',
      mode === 'create' ? 'Опрос создан.' : 'Опрос обновлён.'
    );
    setSubmitting(false);
    if (mode === 'create') {
      router.push('/admin/polls');
    }
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="admin-form">
      <div className="form-field">
        <label title="Вопрос, который увидят читатели. Например: «Какую новеллу переводить следующей?».">
          Вопрос *
        </label>
        <input
          className="form-input"
          value={values.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Что переводить следующим?"
          maxLength={200}
          required
        />
      </div>

      <div className="form-field">
        <label title="Короткое пояснение под вопросом. Необязательно.">
          Описание
        </label>
        <textarea
          className="form-input"
          rows={3}
          value={values.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Например: голосование открыто до конца месяца."
        />
      </div>

      <div className="admin-form-row">
        <div className="form-field" style={{ alignSelf: 'end' }}>
          <label
            className="rs-switch"
            style={{ height: 38 }}
            title="Активный опрос виден на главной и принимает голоса."
          >
            <input
              type="checkbox"
              checked={values.is_active}
              onChange={(e) => set('is_active', e.target.checked)}
            />
            <div>
              <div className="rs-switch-title">Активный</div>
              <div className="rs-switch-sub">Принимает голоса</div>
            </div>
          </label>
        </div>

        <div className="form-field">
          <label title="Дата автозакрытия. Оставь пустым — опрос будет открыт бессрочно.">
            Закрыть до
          </label>
          <input
            type="datetime-local"
            className="form-input"
            value={toDatetimeLocal(values.ends_at)}
            onChange={(e) => set('ends_at', e.target.value || null)}
          />
        </div>
      </div>

      <div className="form-field">
        <label>Варианты ответа *</label>
        <div className="poll-options-editor">
          {values.options.map((o, i) => (
            <div key={o.id ?? `new-${i}`} className="poll-option-editor">
              <div className="poll-option-editor-head">
                <span className="poll-option-editor-num">№{i + 1}</span>
                {values.options.length > 2 && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => removeOption(i)}
                  >
                    Удалить
                  </button>
                )}
              </div>
              <input
                className="form-input"
                placeholder="Название новеллы / вариант"
                value={o.title}
                onChange={(e) => updateOption(i, { title: e.target.value })}
              />
              <textarea
                className="form-input"
                rows={2}
                placeholder="Короткое описание (жанр, сеттинг)"
                value={o.description}
                onChange={(e) =>
                  updateOption(i, { description: e.target.value })
                }
              />
              <div className="admin-form-row">
                <input
                  className="form-input"
                  placeholder="Обложка (URL или covers/x.webp)"
                  value={o.cover_url}
                  onChange={(e) =>
                    updateOption(i, { cover_url: e.target.value })
                  }
                />
                <input
                  className="form-input"
                  placeholder="Внешняя ссылка (novelupdates и т.п.)"
                  value={o.external_link}
                  onChange={(e) =>
                    updateOption(i, { external_link: e.target.value })
                  }
                />
              </div>
            </div>
          ))}
          <button type="button" className="btn btn-ghost" onClick={addOption}>
            + Добавить вариант
          </button>
        </div>
      </div>

      {error && (
        <div style={{ color: 'var(--rose)', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div className="admin-form-footer">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting
            ? 'Сохраняем…'
            : mode === 'create'
            ? 'Создать опрос'
            : 'Сохранить'}
        </button>
      </div>
      <ToastStack items={toasts} onDismiss={dismissToast} />
    </form>
  );
}
