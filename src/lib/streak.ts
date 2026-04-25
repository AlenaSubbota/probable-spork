import type { SupabaseClient } from '@supabase/supabase-js';

// Стрик читателя — личный счётчик дней-подряд + дневник (закладки дня).
//
// Дневник считается отдельно: один день = 0..N записей. На сам стрик
// влияет только факт «открыл главу сегодня». Записи в дневник
// «зарабатывают» заморозки (+1 за каждые 5 записей, см. RPC
// add_diary_entry в миграции 059).

export interface StreakRow {
  user_id: string;
  current_length: number;
  best_length: number;
  last_check_in_date: string | null;
  freezes_available: number;
  freezes_earned_total: number;
  freezes_used_total: number;
  total_check_ins: number;
  total_diary_entries: number;
  created_at: string;
  updated_at: string;
}

export interface DiaryEntryRow {
  id: number;
  user_id: string;
  novel_id: number | null;
  chapter_number: number | null;
  entry_date: string;          // YYYY-MM-DD
  emotion: string | null;
  quote: string | null;
  note: string | null;
  created_at: string;
}

export interface DiaryCalendarRow {
  user_id: string;
  entry_date: string;          // YYYY-MM-DD
  entries_count: number;
  last_emotion: string | null;
}

// Стандартный набор эмодзи. Открытое поле в БД, но фронт всегда
// предлагает выбрать из этих — тогда статистика «любимая эмоция месяца»
// будет осмысленной. Порядок отражает «эмоциональный спектр» от
// светлого к тёмному.
export const DIARY_EMOTIONS: Array<{ key: string; label: string }> = [
  { key: '🔥', label: 'жар' },
  { key: '🥰', label: 'милота' },
  { key: '😍', label: 'влюблённость' },
  { key: '😄', label: 'светло' },
  { key: '🤔', label: 'задумалась' },
  { key: '😱', label: 'шок' },
  { key: '😢', label: 'грустно' },
  { key: '😭', label: 'рыдаю' },
  { key: '💔', label: 'разбитое сердце' },
  { key: '🥺', label: 'тронуло' },
];

export async function fetchMyStreak(
  supabase: SupabaseClient,
  userId: string
): Promise<StreakRow | null> {
  const { data } = await supabase
    .from('reading_streaks')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  return (data ?? null) as StreakRow | null;
}

export async function fetchMyDiaryMonth(
  supabase: SupabaseClient,
  userId: string,
  // первый и последний день месяца включительно (формат YYYY-MM-DD)
  fromDate: string,
  toDate: string
): Promise<DiaryEntryRow[]> {
  const { data } = await supabase
    .from('reading_diary_entries')
    .select('*')
    .eq('user_id', userId)
    .gte('entry_date', fromDate)
    .lte('entry_date', toDate)
    .order('created_at', { ascending: false });
  return (data ?? []) as DiaryEntryRow[];
}

export async function fetchMyCalendarMonth(
  supabase: SupabaseClient,
  userId: string,
  fromDate: string,
  toDate: string
): Promise<DiaryCalendarRow[]> {
  const { data } = await supabase
    .from('diary_calendar_view')
    .select('*')
    .eq('user_id', userId)
    .gte('entry_date', fromDate)
    .lte('entry_date', toDate);
  return (data ?? []) as DiaryCalendarRow[];
}

// Состояние «огня» для виджета шапки и страницы /streak.
// «alive» — зашёл сегодня (или ещё успеет: вчера тоже отметился, гореть
// будет если зайдёт). «cold» — серия больше суток назад, в риске.
// «dead» — никогда не отмечался.
export type StreakState = 'alive' | 'cold' | 'dead';

export function streakState(s: StreakRow | null): StreakState {
  if (!s || s.current_length === 0 || !s.last_check_in_date) return 'dead';
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const last = new Date(s.last_check_in_date + 'T00:00:00Z').getTime();
  const diffDays = Math.round((todayUtc - last) / 86400000);
  if (diffDays <= 0) return 'alive';   // сегодня уже зашёл
  if (diffDays === 1) return 'cold';   // вчера, но сегодня ещё нет
  return 'dead';                       // больше суток без отметки
}

// Помощник: «сколько ещё осталось», если сегодня не отметишься.
// Учитывает заморозки.
export function daysUntilStreakDies(s: StreakRow | null): number | null {
  if (!s || s.current_length === 0 || !s.last_check_in_date) return null;
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const last = new Date(s.last_check_in_date + 'T00:00:00Z').getTime();
  const diffDays = Math.round((todayUtc - last) / 86400000);
  // Завтра без отметки = gap=2 → нужна 1 заморозка. Послезавтра = 2.
  // Сейчас «доступно» freezes_available заморозок. Значит выживет
  // ещё (freezes_available + 1) дней без отметки максимум.
  const tolerance = s.freezes_available + 1; // +1 за завтрашнюю единичку
  return Math.max(0, tolerance - diffDays);
}

// Формат «1 день / 2 дня / 5 дней» для русского
export function pluralDays(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'день';
  if ([2, 3, 4].includes(m10) && ![12, 13, 14].includes(m100)) return 'дня';
  return 'дней';
}

export function pluralEntries(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'запись';
  if ([2, 3, 4].includes(m10) && ![12, 13, 14].includes(m100)) return 'записи';
  return 'записей';
}

// YYYY-MM-DD по UTC. Для отображения в локальной зоне используем
// new Date(s+'T00:00:00').toLocaleDateString().
export function todayKey(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Первый и последний день месяца в YYYY-MM-DD по UTC.
export function monthRange(date: Date = new Date()): { from: string; to: string } {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const from = new Date(Date.UTC(y, m, 1));
  const to = new Date(Date.UTC(y, m + 1, 0));
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return { from: fmt(from), to: fmt(to) };
}
