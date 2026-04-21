'use client';

import { useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { GLOSSARY_CATEGORIES, type GlossaryCategory } from '@/lib/admin';

export interface GlossaryEntry {
  id: number;
  novel_id: number;
  term_original: string;
  term_translation: string;
  category: string | null;
  note: string | null;
}

interface Props {
  novelId: number;
  initial: GlossaryEntry[];
}

export default function GlossaryPanel({ novelId, initial }: Props) {
  const [entries, setEntries] = useState<GlossaryEntry[]>(initial);
  const [termOriginal, setTermOriginal] = useState('');
  const [termTranslation, setTermTranslation] = useState('');
  const [category, setCategory] = useState<GlossaryCategory>('character');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addEntry = async () => {
    setError(null);
    if (!termOriginal.trim() || !termTranslation.trim()) {
      setError('Оба поля обязательны.');
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { data, error: insertError } = await supabase
      .from('novel_glossaries')
      .insert({
        novel_id: novelId,
        term_original: termOriginal.trim(),
        term_translation: termTranslation.trim(),
        category,
        note: note.trim() || null,
      })
      .select('*')
      .single();

    if (insertError) {
      setError(insertError.message);
      setBusy(false);
      return;
    }
    setEntries((prev) => [...prev, data as GlossaryEntry]);
    setTermOriginal('');
    setTermTranslation('');
    setNote('');
    setBusy(false);
  };

  const removeEntry = async (id: number) => {
    if (!confirm('Удалить термин из глоссария?')) return;
    const supabase = createClient();
    const { error: delErr } = await supabase
      .from('novel_glossaries')
      .delete()
      .eq('id', id);
    if (delErr) {
      alert(delErr.message);
      return;
    }
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  return (
    <section className="glossary-panel">
      <div className="section-head">
        <h2>Глоссарий проекта</h2>
        <span className="more" style={{ cursor: 'default' }}>
          {entries.length} {pluralRu(entries.length, 'термин', 'термина', 'терминов')}
        </span>
      </div>
      <p style={{ color: 'var(--ink-mute)', fontSize: 13.5, marginTop: -8, marginBottom: 18 }}>
        Единый словарь имён и терминов. Помогает держать перевод консистентным, а
        читателям — разбираться в сложных терминах без поиска в гугле.
      </p>

      <div className="glossary-add">
        <input
          className="form-input"
          placeholder="Термин оригинала (напр. 哥哥 или hyung)"
          value={termOriginal}
          onChange={(e) => setTermOriginal(e.target.value)}
        />
        <input
          className="form-input"
          placeholder="Наш перевод (напр. старший брат)"
          value={termTranslation}
          onChange={(e) => setTermTranslation(e.target.value)}
        />
        <select
          className="form-input"
          value={category}
          onChange={(e) => setCategory(e.target.value as GlossaryCategory)}
        >
          {(Object.entries(GLOSSARY_CATEGORIES) as [GlossaryCategory, string][]).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input
          className="form-input"
          placeholder="Примечание (опционально)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button type="button" className="btn btn-primary" onClick={addEntry} disabled={busy}>
          {busy ? '…' : '+'}
        </button>
      </div>
      {error && (
        <div style={{ color: 'var(--rose)', fontSize: 13, marginTop: 8 }}>{error}</div>
      )}

      {entries.length > 0 && (
        <table className="glossary-table">
          <thead>
            <tr>
              <th>Категория</th>
              <th>Оригинал</th>
              <th>Перевод</th>
              <th>Примечание</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>
                  <span className="note">
                    {(e.category && GLOSSARY_CATEGORIES[e.category as GlossaryCategory]) || '—'}
                  </span>
                </td>
                <td>
                  <code>{e.term_original}</code>
                </td>
                <td>{e.term_translation}</td>
                <td style={{ color: 'var(--ink-mute)' }}>{e.note ?? ''}</td>
                <td>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => removeEntry(e.id)}
                    title="Удалить"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function pluralRu(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
