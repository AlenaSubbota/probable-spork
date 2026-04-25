'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { useToasts, ToastStack } from '@/components/ui/Toast';
import { DIARY_EMOTIONS, todayKey, pluralEntries } from '@/lib/streak';

interface Props {
  novelId: number;
  chapterNumber: number;
  /** Если null — компонент молча не рендерится (анонимный читатель). */
  isLoggedIn: boolean;
}

interface ExistingEntryShape {
  id: number;
  emotion: string | null;
  quote: string | null;
  note: string | null;
}

// «Закладка дня» — короткая форма после прочтения главы. Эмодзи
// настроения + цитата + своя мысль. Любое поле может быть пустым,
// но что-то одно — обязательно. Запись попадает в личный дневник
// (читать на /streak).
//
// Если на эту главу сегодня уже есть запись — показываем её в
// «свёрнутом» виде, без формы. Можно перезаписать.
export default function DiaryQuickEntry({
  novelId,
  chapterNumber,
  isLoggedIn,
}: Props) {
  const supabase = createClient();
  const { items: toasts, push, dismiss } = useToasts();

  const [emotion, setEmotion] = useState<string | null>(null);
  const [quote, setQuote] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState<ExistingEntryShape | null>(null);
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);

  // Подтянуть «уже есть запись на сегодня» по этой главе
  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const today = todayKey();
      const { data } = await supabase
        .from('reading_diary_entries')
        .select('id, emotion, quote, note')
        .eq('user_id', user.id)
        .eq('novel_id', novelId)
        .eq('chapter_number', chapterNumber)
        .eq('entry_date', today)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        const r = data as ExistingEntryShape;
        setExisting(r);
        setEmotion(r.emotion);
        setQuote(r.quote ?? '');
        setNote(r.note ?? '');
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, novelId, chapterNumber, isLoggedIn]);

  if (!isLoggedIn) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emotion && !quote.trim() && !note.trim()) {
      push('error', 'Хоть что-то — эмодзи, цитата или мысль.');
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc('add_diary_entry', {
      p_novel_id: novelId,
      p_chapter_number: chapterNumber,
      p_emotion: emotion,
      p_quote: quote.trim() || null,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (error) {
      push('error', error.message);
      return;
    }
    push('success', 'Записано в дневник.');
    setExisting(data as ExistingEntryShape);
    setEditing(false);
  };

  // Уже есть запись + не в режиме редактирования → компактный «бейдж»
  if (existing && !editing) {
    return (
      <div className="diary-quick diary-quick--saved">
        <div className="diary-quick-saved-icon" aria-hidden="true">
          {existing.emotion || '📖'}
        </div>
        <div className="diary-quick-saved-body">
          <div className="diary-quick-saved-title">
            Записано в твой <Link href="/streak" className="diary-quick-saved-link">дневник</Link>
          </div>
          {(existing.quote || existing.note) && (
            <div className="diary-quick-saved-text">
              {existing.quote && <em>«{existing.quote}»</em>}
              {existing.quote && existing.note && <span> — </span>}
              {existing.note}
            </div>
          )}
        </div>
        <button
          type="button"
          className="diary-quick-saved-edit"
          onClick={() => setEditing(true)}
          aria-label="Изменить запись"
          title="Изменить"
        >
          ✎
        </button>
        <ToastStack items={toasts} onDismiss={dismiss} />
      </div>
    );
  }

  // Свёрнутый — кнопка «открыть форму»
  if (!open && !editing) {
    return (
      <button
        type="button"
        className="diary-quick diary-quick--cta"
        onClick={() => setOpen(true)}
      >
        <span className="diary-quick-cta-icon" aria-hidden="true">📖</span>
        <span className="diary-quick-cta-text">
          <strong>Запиши закладку дня</strong>
          <span className="diary-quick-cta-sub">
            Эмодзи + цитата = +1 в дневник чтения. За каждые 5 — заморозка стрика.
          </span>
        </span>
        <span className="diary-quick-cta-arrow" aria-hidden="true">→</span>
        <ToastStack items={toasts} onDismiss={dismiss} />
      </button>
    );
  }

  // Развёрнутая форма
  return (
    <form onSubmit={submit} className="diary-quick diary-quick--form">
      <div className="diary-quick-head">
        <span className="diary-quick-head-icon" aria-hidden="true">📖</span>
        <span className="diary-quick-head-text">
          {existing ? 'Перезаписать закладку дня' : 'Закладка дня'}
        </span>
        <button
          type="button"
          className="diary-quick-close"
          onClick={() => {
            if (existing) setEditing(false);
            else setOpen(false);
          }}
          aria-label="Свернуть"
        >
          ×
        </button>
      </div>

      <div className="diary-quick-emotions" role="radiogroup" aria-label="Настроение">
        {DIARY_EMOTIONS.map((e) => {
          const active = emotion === e.key;
          return (
            <button
              type="button"
              key={e.key}
              role="radio"
              aria-checked={active}
              aria-label={e.label}
              className={`diary-quick-emotion${active ? ' is-active' : ''}`}
              onClick={() => setEmotion(active ? null : e.key)}
              title={e.label}
            >
              {e.key}
            </button>
          );
        })}
      </div>

      <div className="form-field">
        <label htmlFor="diary-quote">Цитата (опционально)</label>
        <textarea
          id="diary-quote"
          className="form-textarea"
          rows={2}
          maxLength={600}
          value={quote}
          onChange={(e) => setQuote(e.target.value)}
          placeholder="Подсветь мыслью или вставь любимый кусок"
        />
      </div>

      <div className="form-field">
        <label htmlFor="diary-note">Своя мысль (опционально)</label>
        <input
          id="diary-note"
          className="form-input"
          maxLength={280}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Напр.: ревела весь вечер; не ожидала такого финала"
        />
      </div>

      <div className="diary-quick-actions">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy}
        >
          {busy ? 'Записываем…' : existing ? 'Перезаписать' : '📖 В дневник'}
        </button>
        <Link href="/streak" className="diary-quick-link">
          Открыть дневник →
        </Link>
      </div>

      <ToastStack items={toasts} onDismiss={dismiss} />
    </form>
  );
}
