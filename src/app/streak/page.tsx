import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import {
  fetchMyStreak,
  fetchMyDiaryMonth,
  fetchMyCalendarMonth,
  monthRange,
  pluralDays,
  pluralEntries,
  streakState,
  type DiaryEntryRow,
  type DiaryCalendarRow,
} from '@/lib/streak';

interface PageProps {
  searchParams: Promise<{ m?: string }>;
}

export const metadata = { title: 'Дневник чтения — Chaptify' };

// Личный экран читателя: текущий стрик + календарь месяца + лента
// записей дневника. Всё про эмоциональную летопись отношений с
// книгами, не про функциональный «прогресс».
export default async function StreakPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=' + encodeURIComponent('/streak'));

  // Месяц можно листать через ?m=YYYY-MM. По умолчанию — текущий.
  const sp = await searchParams;
  const monthDate = parseMonth(sp.m) ?? new Date();
  const { from, to } = monthRange(monthDate);

  const [streak, diary, calendar, novelsRaw] = await Promise.all([
    fetchMyStreak(supabase, user.id),
    fetchMyDiaryMonth(supabase, user.id, from, to),
    fetchMyCalendarMonth(supabase, user.id, from, to),
    // Заголовки новелл, на которые ссылается дневник этого месяца —
    // одним JOIN'ом не делаем (RLS на novels), просто лукапом.
    supabase.from('novels').select('id, title, firebase_id'),
  ]);

  const novels = (novelsRaw.data ?? []) as Array<{
    id: number;
    title: string;
    firebase_id: string;
  }>;
  const novelMap = new Map(novels.map((n) => [n.id, n]));

  const state = streakState(streak);
  const checkedToday = state === 'alive';

  // Сетка месяца: понедельник=0 ... воскресенье=6 (русский календарь).
  // 6 строк × 7 столбцов = достаточно для любого месяца.
  const cells = buildMonthGrid(monthDate, calendar);

  const prevMonth = shiftMonth(monthDate, -1);
  const nextMonth = shiftMonth(monthDate, +1);
  const monthLabel = formatMonthLabel(monthDate);

  return (
    <main className="container streak-page">
      <div className="admin-breadcrumbs">
        <Link href="/">Главная</Link>
        <span>/</span>
        <span>Дневник чтения</span>
      </div>
      <header className="streak-hero">
        <div className="streak-hero-flame" aria-hidden="true">
          <span className={`streak-flame streak-flame--${state}`}>
            {state === 'dead' ? '🌑' : '🔥'}
          </span>
        </div>
        <div className="streak-hero-text">
          <span className="pm-hero-eyebrow">📖 Дневник чтения</span>
          <h1 className="streak-hero-title">
            {streak?.current_length ?? 0}{' '}
            <span className="streak-hero-title-unit">
              {pluralDays(streak?.current_length ?? 0)}
            </span>
          </h1>
          <p className="streak-hero-sub">
            {state === 'alive' && 'Сегодня уже отметил_ась — огонёк в безопасности.'}
            {state === 'cold' && 'Вчера была отметка. Зайди в любую главу до конца дня — и стрик продолжится.'}
            {state === 'dead' && 'Огонь погас. Открой главу и начни с нуля — каждый день считается.'}
          </p>
          <div className="streak-hero-stats">
            <div className="streak-stat">
              <div className="streak-stat-val">{streak?.best_length ?? 0}</div>
              <div className="streak-stat-label">лучшая серия</div>
            </div>
            <div className="streak-stat">
              <div className="streak-stat-val">{streak?.freezes_available ?? 0}</div>
              <div className="streak-stat-label">заморозок</div>
            </div>
            <div className="streak-stat">
              <div className="streak-stat-val">{streak?.total_diary_entries ?? 0}</div>
              <div className="streak-stat-label">записей</div>
            </div>
          </div>
        </div>
      </header>

      <section className="streak-section">
        <div className="streak-section-head">
          <h2 className="streak-section-title">{monthLabel}</h2>
          <div className="streak-month-nav">
            <Link
              href={`/streak?m=${prevMonth.y}-${String(prevMonth.m + 1).padStart(2, '0')}`}
              className="btn btn-ghost"
            >
              ←
            </Link>
            <Link
              href="/streak"
              className="btn btn-ghost"
              aria-label="Текущий месяц"
              title="Текущий"
            >
              ⌂
            </Link>
            <Link
              href={`/streak?m=${nextMonth.y}-${String(nextMonth.m + 1).padStart(2, '0')}`}
              className="btn btn-ghost"
            >
              →
            </Link>
          </div>
        </div>

        <div className="streak-calendar" role="grid" aria-label="Календарь чтения">
          <div className="streak-calendar-weekdays" aria-hidden="true">
            {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => (
              <div key={d} className="streak-calendar-weekday">{d}</div>
            ))}
          </div>
          <div className="streak-calendar-grid">
            {cells.map((c, i) => {
              const ariaLabel = c.outside
                ? ''
                : c.entriesCount > 0
                  ? `${c.day} число — ${c.entriesCount} ${pluralEntries(c.entriesCount)}${
                      c.today ? ', сегодня' : ''
                    }`
                  : `${c.day} число${c.today ? ', сегодня' : ''} — нет записей`;
              return (
                <div
                  key={i}
                  role="gridcell"
                  aria-label={ariaLabel || undefined}
                  aria-hidden={c.outside ? 'true' : undefined}
                  className={
                    'streak-calendar-cell' +
                    (c.outside ? ' is-outside' : '') +
                    (c.today ? ' is-today' : '') +
                    (c.entriesCount > 0 ? ' is-marked' : '')
                  }
                  title={ariaLabel}
                >
                  <div className="streak-calendar-cell-num">{c.day}</div>
                  {c.lastEmotion && (
                    <div className="streak-calendar-cell-emoji" aria-hidden="true">
                      {c.lastEmotion}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="streak-section">
        <div className="streak-section-head">
          <h2 className="streak-section-title">
            Записи <small className="streak-section-count">({diary.length})</small>
          </h2>
          {!checkedToday && (
            <Link href="/feed" className="btn btn-primary">
              📖 Открыть главу
            </Link>
          )}
        </div>

        {diary.length === 0 ? (
          <div className="empty-state" style={{ padding: 22 }}>
            <p style={{ margin: 0 }}>
              За {monthLabel.toLowerCase()} ничего не записано. Открой
              любую главу — после прочтения предложат оставить эмодзи и
              цитату.
            </p>
          </div>
        ) : (
          <div className="streak-diary">
            {diary.map((e) => {
              const novel = e.novel_id ? novelMap.get(e.novel_id) : null;
              return (
                <article key={e.id} className="streak-diary-entry">
                  <div className="streak-diary-entry-side">
                    <div className="streak-diary-entry-date">
                      {formatDayLabel(e.entry_date)}
                    </div>
                    {e.emotion && (
                      <div className="streak-diary-entry-emotion" aria-hidden="true">
                        {e.emotion}
                      </div>
                    )}
                  </div>
                  <div className="streak-diary-entry-body">
                    {novel && (
                      <Link
                        href={
                          e.chapter_number
                            ? `/novel/${novel.firebase_id}/${e.chapter_number}`
                            : `/novel/${novel.firebase_id}`
                        }
                        className="streak-diary-entry-novel"
                      >
                        {novel.title}
                        {e.chapter_number ? ` · гл. ${e.chapter_number}` : ''}
                      </Link>
                    )}
                    {e.quote && (
                      <blockquote className="streak-diary-entry-quote">
                        «{e.quote}»
                      </blockquote>
                    )}
                    {e.note && (
                      <div className="streak-diary-entry-note">{e.note}</div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="streak-tips">
        <h3 className="streak-tips-title">Как это работает</h3>
        <ul className="streak-tips-list">
          <li>
            <strong>Огонёк</strong> — за каждый день, в который ты открыл_а
            хотя бы одну главу. Пропуск — гаснет.
          </li>
          <li>
            <strong>Заморозка</strong> спасает один пропущенный день.
            +1 заморозка автоматом за каждые 5 записей в дневник.
          </li>
          <li>
            <strong>Дневник</strong> — твоя личная летопись отношений с
            книгами. Эмодзи + цитата + мысль. Никто кроме тебя его не
            видит.
          </li>
        </ul>
      </section>
    </main>
  );
}

// ---------- helpers ----------

function parseMonth(s?: string): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, 1));
}

function shiftMonth(date: Date, delta: number): { y: number; m: number } {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + delta;
  const d = new Date(Date.UTC(y, m, 1));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
}

function formatMonthLabel(date: Date): string {
  const months = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
  ];
  return `${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    weekday: 'short',
    timeZone: 'UTC',
  });
}

interface CalendarCell {
  day: number;
  outside: boolean;
  today: boolean;
  entriesCount: number;
  lastEmotion: string | null;
}

function buildMonthGrid(monthDate: Date, calendar: DiaryCalendarRow[]): CalendarCell[] {
  const y = monthDate.getUTCFullYear();
  const m = monthDate.getUTCMonth();
  const first = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

  // День недели первого числа в формате 0..6, где 0 = понедельник.
  const firstDow = (first.getUTCDay() + 6) % 7;

  // Календарный лукап: YYYY-MM-DD → row
  const cMap = new Map<string, DiaryCalendarRow>();
  for (const c of calendar) cMap.set(c.entry_date, c);

  const cells: CalendarCell[] = [];
  // Заполнители из прошлого месяца до начала
  const prevLastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let i = 0; i < firstDow; i++) {
    cells.push({
      day: prevLastDay - firstDow + 1 + i,
      outside: true,
      today: false,
      entriesCount: 0,
      lastEmotion: null,
    });
  }
  const todayUtc = new Date();
  const todayKey =
    `${todayUtc.getUTCFullYear()}-${String(todayUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(todayUtc.getUTCDate()).padStart(2, '0')}`;
  for (let day = 1; day <= lastDay; day++) {
    const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const c = cMap.get(key);
    cells.push({
      day,
      outside: false,
      today: key === todayKey,
      entriesCount: c?.entries_count ?? 0,
      lastEmotion: c?.last_emotion ?? null,
    });
  }
  // Хвост из следующего месяца, чтобы добить до 42 ячеек (6 строк)
  while (cells.length % 7 !== 0) {
    cells.push({
      day: cells.length - lastDay - firstDow + 1,
      outside: true,
      today: false,
      entriesCount: 0,
      lastEmotion: null,
    });
  }
  return cells;
}
