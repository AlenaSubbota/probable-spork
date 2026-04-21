'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { getCoverUrl } from '@/lib/format';
import { WEEKDAYS, WEEKDAY_LABELS_SHORT, WEEKDAY_LABELS_LONG } from '@/lib/admin';

export interface ScheduleSlot {
  id: number;
  novel_id: number;
  day_of_week: number;
  time_of_day: string | null;
  note: string | null;
  novel_title: string;
  novel_firebase_id: string;
  novel_cover_url: string | null;
}

interface NovelOption {
  id: number;
  title: string;
  firebase_id: string;
  cover_url: string | null;
}

interface Props {
  translatorId: string;
  initialSlots: ScheduleSlot[];
  myNovels: NovelOption[];
}

// Редактор расписания переводчика. Сетка Пн-Вс, в каждой колонке — слоты
// (мини-карточки новелл). Добавление через модальный «Добавить слот»: выбор
// новеллы (по поиску или из своих), дни недели (multi-select), опц. время
// и короткая заметка. Всё пишется в public.translator_schedule, RLS
// ограничивает писать только свои слоты.
export default function ScheduleEditor({
  translatorId,
  initialSlots,
  myNovels,
}: Props) {
  const router = useRouter();
  const [slots, setSlots] = useState<ScheduleSlot[]>(initialSlots);
  const [adding, setAdding] = useState<number | null>(null); // day_of_week для pre-fill
  const [busyId, setBusyId] = useState<number | null>(null);

  const byDay = new Map<number, ScheduleSlot[]>();
  for (const d of WEEKDAYS) byDay.set(d, []);
  for (const s of slots) byDay.get(s.day_of_week)?.push(s);

  const removeSlot = async (slot: ScheduleSlot) => {
    setBusyId(slot.id);
    const supabase = createClient();
    const { error } = await supabase
      .from('translator_schedule')
      .delete()
      .eq('id', slot.id);
    setBusyId(null);
    if (!error) {
      setSlots((prev) => prev.filter((s) => s.id !== slot.id));
      router.refresh();
    }
  };

  const onAdded = (newSlots: ScheduleSlot[]) => {
    setSlots((prev) => [...prev, ...newSlots]);
    setAdding(null);
    router.refresh();
  };

  return (
    <>
      <div className="schedule-grid">
        {WEEKDAYS.map((d) => {
          const daySlots = byDay.get(d) ?? [];
          return (
            <div key={d} className="schedule-day">
              <div className="schedule-day-head">
                <span className="schedule-day-short">{WEEKDAY_LABELS_SHORT[d]}</span>
                <span className="schedule-day-long">{WEEKDAY_LABELS_LONG[d]}</span>
              </div>
              <div className="schedule-day-body">
                {daySlots.length === 0 && (
                  <div className="schedule-day-empty">Пусто</div>
                )}
                {daySlots.map((s) => (
                  <div key={s.id} className="schedule-slot">
                    <div className="schedule-slot-cover">
                      {s.novel_cover_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={getCoverUrl(s.novel_cover_url) ?? ''}
                          alt=""
                        />
                      ) : (
                        <div className="placeholder p1" style={{ fontSize: 9 }}>
                          {s.novel_title}
                        </div>
                      )}
                    </div>
                    <div className="schedule-slot-body">
                      <div className="schedule-slot-title">{s.novel_title}</div>
                      {(s.time_of_day || s.note) && (
                        <div className="schedule-slot-meta">
                          {s.time_of_day && (
                            <span>{formatTime(s.time_of_day)}</span>
                          )}
                          {s.note && <span className="schedule-slot-note">{s.note}</span>}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="schedule-slot-del"
                      onClick={() => removeSlot(s)}
                      disabled={busyId === s.id}
                      aria-label="Убрать"
                      title="Убрать из расписания"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="schedule-add-btn"
                  onClick={() => setAdding(d)}
                >
                  + Добавить
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {adding !== null && (
        <AddSlotModal
          translatorId={translatorId}
          defaultDay={adding}
          myNovels={myNovels}
          onClose={() => setAdding(null)}
          onAdded={onAdded}
        />
      )}
    </>
  );
}

interface AddSlotModalProps {
  translatorId: string;
  defaultDay: number;
  myNovels: NovelOption[];
  onClose: () => void;
  onAdded: (slots: ScheduleSlot[]) => void;
}

function AddSlotModal({
  translatorId,
  defaultDay,
  myNovels,
  onClose,
  onAdded,
}: AddSlotModalProps) {
  const [picked, setPicked] = useState<NovelOption | null>(null);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<NovelOption[]>([]);
  const [days, setDays] = useState<number[]>([defaultDay]);
  const [time, setTime] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escape закрывает
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Поиск среди всех новелл (не только моих) — админ может ставить чужие.
  // Сначала показываем мои как быстрые пики.
  useEffect(() => {
    if (query.trim().length < 2) {
      setOptions([]);
      return;
    }
    const handle = window.setTimeout(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('novels')
        .select('id, title, firebase_id, cover_url')
        .ilike('title', `%${query.replace(/[%_]/g, '\\$&')}%`)
        .limit(10);
      setOptions((data ?? []) as NovelOption[]);
    }, 180);
    return () => window.clearTimeout(handle);
  }, [query]);

  const toggleDay = (d: number) =>
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );

  const submit = async () => {
    setError(null);
    if (!picked) {
      setError('Выбери новеллу.');
      return;
    }
    if (days.length === 0) {
      setError('Выбери хотя бы один день.');
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const rows = days.map((d) => ({
      translator_id: translatorId,
      novel_id: picked.id,
      day_of_week: d,
      time_of_day: time || null,
      note: note.trim() || null,
    }));
    const { data, error: insertErr } = await supabase
      .from('translator_schedule')
      .insert(rows)
      .select('id, novel_id, day_of_week, time_of_day, note');
    setBusy(false);
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    const added: ScheduleSlot[] = (data ?? []).map((r) => ({
      id: r.id,
      novel_id: r.novel_id,
      day_of_week: r.day_of_week,
      time_of_day: r.time_of_day,
      note: r.note,
      novel_title: picked.title,
      novel_firebase_id: picked.firebase_id,
      novel_cover_url: picked.cover_url,
    }));
    onAdded(added);
  };

  return (
    <div
      className="story-modal"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="story-modal-card schedule-modal-card"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="story-modal-close"
          onClick={onClose}
          aria-label="Закрыть"
        >
          ×
        </button>
        <div className="schedule-modal-body">
          <h3 className="story-modal-title">Добавить в расписание</h3>

          {picked ? (
            <div className="schedule-picked">
              <div className="schedule-picked-cover">
                {picked.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={getCoverUrl(picked.cover_url) ?? ''}
                    alt=""
                  />
                ) : (
                  <div className="placeholder p1" style={{ fontSize: 9 }}>
                    {picked.title}
                  </div>
                )}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{picked.title}</div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ height: 30, marginTop: 4 }}
                  onClick={() => setPicked(null)}
                >
                  Выбрать другую
                </button>
              </div>
            </div>
          ) : (
            <>
              {myNovels.length > 0 && (
                <>
                  <div className="form-field-label">Мои новеллы</div>
                  <div className="schedule-quick">
                    {myNovels.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        className="schedule-quick-item"
                        onClick={() => setPicked(n)}
                      >
                        <div className="schedule-quick-cover">
                          {n.cover_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={getCoverUrl(n.cover_url) ?? ''}
                              alt=""
                            />
                          ) : (
                            <div
                              className="placeholder p1"
                              style={{ fontSize: 9 }}
                            >
                              {n.title}
                            </div>
                          )}
                        </div>
                        <span>{n.title}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              <div className="form-field" style={{ marginTop: 12 }}>
                <label>Поиск по всем новеллам</label>
                <input
                  className="form-input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Начни писать название…"
                  autoFocus
                />
              </div>
              {options.length > 0 && (
                <div className="schedule-search-results">
                  {options.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className="schedule-search-item"
                      onClick={() => setPicked(o)}
                    >
                      {o.title}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {picked && (
            <>
              <div className="form-field" style={{ marginTop: 14 }}>
                <label>Дни недели</label>
                <div className="schedule-days-picker">
                  {WEEKDAYS.map((d) => (
                    <button
                      type="button"
                      key={d}
                      className={`schedule-day-chip${days.includes(d) ? ' is-on' : ''}`}
                      onClick={() => toggleDay(d)}
                    >
                      {WEEKDAY_LABELS_SHORT[d]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="admin-form-row">
                <div className="form-field">
                  <label title="Во сколько выходит глава. Необязательно — часто расписание в формате «когда-то в среду».">
                    Время (опц.)
                  </label>
                  <input
                    type="time"
                    className="form-input"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </div>
                <div className="form-field" style={{ flex: 2 }}>
                  <label title="Короткая заметка для читателей: например, «1 глава» или «платные главы».">
                    Заметка (опц.)
                  </label>
                  <input
                    className="form-input"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="1 глава"
                    maxLength={200}
                  />
                </div>
              </div>

              {error && (
                <div
                  style={{
                    color: 'var(--rose)',
                    fontSize: 13,
                    marginTop: 8,
                  }}
                >
                  {error}
                </div>
              )}

              <div className="admin-form-footer" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={submit}
                  disabled={busy}
                >
                  {busy ? 'Добавляем…' : 'Добавить'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={onClose}
                >
                  Отмена
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTime(t: string): string {
  // postgres time приходит как 'HH:MM:SS' — режем секунды
  return t.slice(0, 5);
}
