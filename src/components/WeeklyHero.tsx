import Link from 'next/link';
import { formatCount } from '@/lib/format';
 
interface TranslatorBreakdown {
  name: string;
  count: number;
  tint?: 'coffee' | 'leaf';
}
 
interface Props {
  newChaptersThisWeek: number;
  totalChapters: number;
  totalNovels: number;
  latestChapter: {
    novelTitle: string;
    novelFirebaseId: string;
    chapterNumber: number;
    chapterTitle: string | null;
  } | null;
  translators: TranslatorBreakdown[];
}
 
export default function WeeklyHero({
  newChaptersThisWeek,
  totalChapters,
  totalNovels,
  latestChapter,
  translators,
}: Props) {
  return (
    <section className="container hero">
      <div className="hero-grid">
        <div className="hero-card">
          <span className="eyebrow">На этой неделе</span>
          <h1 style={{ fontSize: 44, lineHeight: 1.05 }}>
            {newChaptersThisWeek}{' '}
            <span style={{ fontSize: 22, color: 'var(--ink-mute)', fontWeight: 500 }}>
              {pluralChapters(newChaptersThisWeek)}
            </span>
          </h1>
          <p>
            Всего {formatCount(totalChapters)} глав в {totalNovels}{' '}
            {pluralNovels(totalNovels)}. Прогресс чтения и монетки синхронизированы с tene.fun.
          </p>
          {latestChapter && (
            <div
              style={{
                marginTop: 4,
                padding: '12px 14px',
                background: 'rgba(255,255,255,.55)',
                borderRadius: 10,
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '.08em',
                  color: 'var(--accent-hover)',
                  textTransform: 'uppercase',
                }}
              >
                Свежее
              </span>
              <Link
                href={`/novel/${latestChapter.novelFirebaseId}/${latestChapter.chapterNumber}`}
                style={{ color: 'var(--ink)', fontWeight: 600, textDecoration: 'underline' }}
              >
                {latestChapter.novelTitle} — гл. {latestChapter.chapterNumber}
                {latestChapter.chapterTitle ? ` «${latestChapter.chapterTitle}»` : ''}
              </Link>
            </div>
          )}
          <div className="actions-row" style={{ marginTop: 16 }}>
            <Link href="/catalog" className="btn btn-primary">
              Открыть каталог
            </Link>
            <Link href="/profile" className="btn btn-ghost">
              Пополнить баланс
            </Link>
          </div>
        </div>
 
        <div className="hero-side">
          {translators.length > 0 ? (
            translators.map((t) => (
              <div key={t.name} className="hero-card">
                <span
                  className="note"
                  style={
                    t.tint === 'leaf'
                      ? { background: '#E3EBD6', color: '#4C6A34' }
                      : undefined
                  }
                >
                  {t.name}
                </span>
                <h3>
                  {t.count}{' '}
                  {t.count === 1 ? 'глава' : t.count < 5 ? 'главы' : 'глав'} за неделю
                </h3>
                <p style={{ margin: 0, color: 'var(--ink-mute)', fontSize: 13 }}>
                  {t.count === 0 ? 'Пока тихо, скоро обновится.' : 'Свежие переводы подъехали.'}
                </p>
              </div>
            ))
          ) : (
            <div className="hero-card">
              <span className="note">Бета</span>
              <h3>Закрытое тестирование</h3>
              <p style={{ margin: 0, color: 'var(--ink-mute)', fontSize: 13 }}>
                Совсем скоро — публичный запуск.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
 
function pluralChapters(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return 'новых глав';
  if (mod10 === 1) return 'новая глава';
  if (mod10 >= 2 && mod10 <= 4) return 'новые главы';
  return 'новых глав';
}
 
function pluralNovels(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return 'новеллах';
  if (mod10 === 1) return 'новелле';
  if (mod10 >= 2 && mod10 <= 4) return 'новеллах';
  return 'новеллах';
}