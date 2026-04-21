import Link from 'next/link';
import { getCoverUrl } from '@/lib/format';
import { WEEKDAYS, WEEKDAY_LABELS_SHORT, WEEKDAY_LABELS_LONG } from '@/lib/admin';

export interface PublicScheduleSlot {
  id: number;
  day_of_week: number;
  time_of_day: string | null;
  note: string | null;
  novel_firebase_id: string;
  novel_title: string;
  novel_cover_url: string | null;
}

interface Props {
  slots: PublicScheduleSlot[];
  todayDow: number; // 0=Пн … 6=Вс
}

// Публичное расписание переводчика на странице профиля. Сетка из 7 дней,
// сегодняшний подсвечен. Если расписание пустое — блок не рендерится
// (пусть профиль выглядит так же, как раньше, пока переводчик не заполнит).
export default function TranslatorSchedule({ slots, todayDow }: Props) {
  if (slots.length === 0) return null;

  const byDay = new Map<number, PublicScheduleSlot[]>();
  for (const d of WEEKDAYS) byDay.set(d, []);
  for (const s of slots) byDay.get(s.day_of_week)?.push(s);

  return (
    <section className="section">
      <div className="section-head">
        <h2>Расписание выхода глав</h2>
        <span className="more" style={{ cursor: 'default' }}>
          По неделям
        </span>
      </div>

      <div className="schedule-public">
        {WEEKDAYS.map((d) => {
          const daySlots = byDay.get(d) ?? [];
          const isToday = d === todayDow;
          return (
            <div
              key={d}
              className={`schedule-public-day${isToday ? ' is-today' : ''}`}
            >
              <div className="schedule-public-day-head">
                <span className="schedule-public-day-short">
                  {WEEKDAY_LABELS_SHORT[d]}
                </span>
                <span className="schedule-public-day-long">
                  {WEEKDAY_LABELS_LONG[d]}
                </span>
                {isToday && (
                  <span className="schedule-public-today">сегодня</span>
                )}
              </div>
              <div className="schedule-public-day-body">
                {daySlots.length === 0 ? (
                  <div className="schedule-public-empty">—</div>
                ) : (
                  daySlots.map((s) => (
                    <Link
                      key={s.id}
                      href={`/novel/${s.novel_firebase_id}`}
                      className="schedule-public-slot"
                    >
                      <div className="schedule-public-cover">
                        {s.novel_cover_url ? (
                          <img
                            src={getCoverUrl(s.novel_cover_url) ?? ''}
                            alt=""
                          />
                        ) : (
                          <div
                            className="placeholder p1"
                            style={{ fontSize: 9 }}
                          >
                            {s.novel_title}
                          </div>
                        )}
                      </div>
                      <div className="schedule-public-body">
                        <div className="schedule-public-title">
                          {s.novel_title}
                        </div>
                        {(s.time_of_day || s.note) && (
                          <div className="schedule-public-meta">
                            {s.time_of_day && (
                              <span>{s.time_of_day.slice(0, 5)}</span>
                            )}
                            {s.note && <span>{s.note}</span>}
                          </div>
                        )}
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
