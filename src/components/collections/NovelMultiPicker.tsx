'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { getCoverUrl } from '@/lib/format';

interface Candidate {
  firebase_id: string;
  title: string;
  cover_url: string | null;
  author: string | null;
}

export interface PickedNovel {
  firebase_id: string;
  title: string;
  cover_url: string | null;
}

interface Props {
  value: PickedNovel[];
  onChange: (next: PickedNovel[]) => void;
  /** Лимит размера подборки. Совпадает с CHECK в миграции. */
  max?: number;
}

// Мультиселект новелл с поиском по названию (debounce 220 мс).
// Возвращает массив { firebase_id, title, cover_url } в порядке выбора.
// Поддержка переупорядочивания стрелками и удаления.
export default function NovelMultiPicker({ value, onChange, max = 50 }: Props) {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<number | null>(null);

  const pickedIds = new Set(value.map((p) => p.firebase_id));

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      if (query.trim().length < 2) {
        setCandidates([]);
        return;
      }
      setLoading(true);
      const supabase = createClient();
      const pattern = `%${query.replace(/[%_]/g, '\\$&')}%`;
      const { data } = await supabase
        .from('novels_view')
        .select('firebase_id, title, cover_url, author')
        .eq('moderation_status', 'published')
        .or(`title.ilike.${pattern},title_original.ilike.${pattern},title_en.ilike.${pattern}`)
        .limit(12);
      setCandidates((data ?? []) as Candidate[]);
      setLoading(false);
    }, 220);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  const add = (c: Candidate) => {
    if (pickedIds.has(c.firebase_id)) return;
    if (value.length >= max) return;
    onChange([
      ...value,
      { firebase_id: c.firebase_id, title: c.title, cover_url: c.cover_url },
    ]);
    setQuery('');
    setCandidates([]);
  };

  const remove = (id: string) => {
    onChange(value.filter((p) => p.firebase_id !== id));
  };

  const move = (id: string, dir: -1 | 1) => {
    const idx = value.findIndex((p) => p.firebase_id === id);
    if (idx < 0) return;
    const swap = idx + dir;
    if (swap < 0 || swap >= value.length) return;
    const next = [...value];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    onChange(next);
  };

  return (
    <div className="novel-multi-picker">
      <div className="novel-multi-picker-search">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            value.length >= max
              ? `Достигнут лимит в ${max} новелл`
              : 'Найти новеллу по названию…'
          }
          disabled={value.length >= max}
          className="novel-multi-picker-input"
        />
        {loading && (
          <span className="novel-multi-picker-loading">Ищу…</span>
        )}
      </div>

      {candidates.length > 0 && (
        <ul className="novel-multi-picker-results">
          {candidates.map((c) => {
            const taken = pickedIds.has(c.firebase_id);
            const cover = getCoverUrl(c.cover_url);
            return (
              <li key={c.firebase_id}>
                <button
                  type="button"
                  className={`novel-multi-picker-result${taken ? ' is-taken' : ''}`}
                  onClick={() => add(c)}
                  disabled={taken}
                >
                  <span className="novel-multi-picker-result-cover">
                    {cover ? (
                      <img src={cover} alt="" />
                    ) : (
                      <span className="placeholder p1">{c.title.slice(0, 2)}</span>
                    )}
                  </span>
                  <span className="novel-multi-picker-result-body">
                    <span className="novel-multi-picker-result-title">{c.title}</span>
                    {c.author && (
                      <span className="novel-multi-picker-result-author">
                        {c.author}
                      </span>
                    )}
                  </span>
                  <span className="novel-multi-picker-result-action">
                    {taken ? '✓ уже в подборке' : '+ добавить'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="novel-multi-picker-summary">
        Выбрано: <strong>{value.length}</strong> из {max}
      </div>

      {value.length > 0 && (
        <ol className="novel-multi-picker-picked">
          {value.map((p, i) => {
            const cover = getCoverUrl(p.cover_url);
            return (
              <li key={p.firebase_id} className="novel-multi-picker-picked-item">
                <span className="novel-multi-picker-picked-num">{i + 1}</span>
                <span className="novel-multi-picker-picked-cover">
                  {cover ? (
                    <img src={cover} alt="" />
                  ) : (
                    <span className="placeholder p1">{p.title.slice(0, 2)}</span>
                  )}
                </span>
                <span className="novel-multi-picker-picked-title">{p.title}</span>
                <div className="novel-multi-picker-picked-actions">
                  <button
                    type="button"
                    onClick={() => move(p.firebase_id, -1)}
                    disabled={i === 0}
                    aria-label="Поднять"
                    title="Поднять"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(p.firebase_id, 1)}
                    disabled={i === value.length - 1}
                    aria-label="Опустить"
                    title="Опустить"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(p.firebase_id)}
                    aria-label="Удалить"
                    title="Удалить"
                    className="novel-multi-picker-picked-remove"
                  >
                    ×
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
