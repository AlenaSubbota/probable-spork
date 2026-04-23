import Link from 'next/link';

// Мини-таймлайн отношений читателя с новеллой.
// Собирается на сервере из уже-подгружённых данных (`profile.last_read`,
// user_quotes, chapter_thanks) — без лишних круговых запросов. Если ничего
// не нашлось (новелла новая для читателя) — компонент не рендерится.

interface Props {
  novelId: number;
  totalChapters: number;
  // Текущий прогресс в новелле (chapterId из last_read[novelId])
  currentChapter: number | null;
  startedAt: string | null;
  // Сколько цитат сохранил читатель в этой новелле
  quotesCount: number;
  // Сколько «спасибо» поставил под главами
  thanksCount: number;
  // Сколько дней был активен в этой новелле (уникальные дни в reading_days)
  activeDays: number;
  novelIsCompleted: boolean;
  novelFirebaseId: string;
}

function ruDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function humanRange(startIso: string): string {
  const start = new Date(startIso).getTime();
  const diffDays = Math.max(0, Math.floor((Date.now() - start) / 86_400_000));
  if (diffDays === 0) return 'сегодня';
  if (diffDays === 1) return 'вчера';
  if (diffDays < 30) return `${diffDays} дн. назад`;
  if (diffDays < 365) return `${Math.round(diffDays / 30)} мес. назад`;
  return `${Math.round(diffDays / 365)} г. назад`;
}

export default function MyNovelHistory(props: Props) {
  const {
    novelId,
    totalChapters,
    currentChapter,
    startedAt,
    quotesCount,
    thanksCount,
    activeDays,
    novelIsCompleted,
    novelFirebaseId,
  } = props;

  const hasAnyHistory =
    currentChapter !== null ||
    startedAt !== null ||
    quotesCount > 0 ||
    thanksCount > 0 ||
    activeDays > 0;

  if (!hasAnyHistory) return null;

  const progressPct = totalChapters > 0 && currentChapter
    ? Math.min(100, Math.round((currentChapter / totalChapters) * 100))
    : null;

  const isFinished =
    novelIsCompleted &&
    currentChapter !== null &&
    totalChapters > 0 &&
    currentChapter >= totalChapters;

  return (
    <section className="my-novel-history">
      <div className="my-novel-history-head">
        <span className="my-novel-history-kicker">Моя история</span>
        <h3>
          {isFinished
            ? 'Эта новелла сопровождала тебя'
            : startedAt
              ? 'Читаешь с'
              : 'Ты уже здесь был_а'}
          {' '}
          {startedAt && !isFinished && <span>{humanRange(startedAt)}</span>}
        </h3>
      </div>

      <div className="my-novel-history-grid">
        {currentChapter !== null && (
          <div className="my-novel-history-cell">
            <div className="my-novel-history-val">
              {currentChapter}
              {totalChapters > 0 && (
                <span className="my-novel-history-val-sub"> / {totalChapters}</span>
              )}
            </div>
            <div className="my-novel-history-label">
              {isFinished ? 'дочитал_а' : 'где я сейчас'}
            </div>
          </div>
        )}

        {activeDays > 0 && (
          <div className="my-novel-history-cell">
            <div className="my-novel-history-val">{activeDays}</div>
            <div className="my-novel-history-label">
              {activeDays === 1 ? 'день с этой книгой' : 'дней с этой книгой'}
            </div>
          </div>
        )}

        {quotesCount > 0 && (
          <div className="my-novel-history-cell">
            <div className="my-novel-history-val">{quotesCount}</div>
            <div className="my-novel-history-label">
              {quotesCount === 1 ? 'цитата сохранена' : 'цитат сохранила'}
            </div>
          </div>
        )}

        {thanksCount > 0 && (
          <div className="my-novel-history-cell">
            <div className="my-novel-history-val">{thanksCount}</div>
            <div className="my-novel-history-label">
              {thanksCount === 1 ? 'спасибо сказала' : 'раз поблагодарил_а'}
            </div>
          </div>
        )}
      </div>

      {progressPct !== null && !isFinished && (
        <div className="my-novel-history-bar">
          <div className="my-novel-history-bar-fill" style={{ width: `${progressPct}%` }} />
          <span className="my-novel-history-bar-label">
            {progressPct}% пути
          </span>
        </div>
      )}

      {startedAt && (
        <div className="my-novel-history-foot">
          Открыл_а {ruDate(startedAt)}
          {isFinished && <span> · дочитал_а · теперь остаётся только помнить</span>}
          {quotesCount > 0 && (
            <>
              {' · '}
              <Link href={`/profile#quotes`} className="more">
                открыть сохранённое →
              </Link>
            </>
          )}
        </div>
      )}
    </section>
  );
}
