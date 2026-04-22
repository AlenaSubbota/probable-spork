import Link from 'next/link';

interface Props {
  chaptersRead: number;       // суммарно прочитано глав (по last_read)
  novelsStarted: number;      // новелл с хотя бы одной прочитанной главой
  estHoursRead: number;       // оценка часов чтения
  favoriteTranslator: {
    name: string;
    slug: string | null;
    chapters: number;
  } | null;
}

// Профильная карточка с агрегированной статистикой чтения.
// Считаем на стороне сервера из profiles.last_read + novels/profiles.
// Не претендует на точность — даёт порядок величины («сколько я всего
// прочитал_а тут»), читателю приятно.
export default function ReadingTotals({
  chaptersRead,
  novelsStarted,
  estHoursRead,
  favoriteTranslator,
}: Props) {
  if (chaptersRead === 0) return null;

  return (
    <section className="reading-totals">
      <div className="section-head">
        <h2>Моя статистика</h2>
      </div>
      <div className="reading-totals-grid">
        <div className="reading-totals-card">
          <div className="reading-totals-value">
            {chaptersRead.toLocaleString('ru-RU')}
          </div>
          <div className="reading-totals-label">
            {pluralRu(chaptersRead, 'глава', 'главы', 'глав')} прочитано
          </div>
        </div>
        <div className="reading-totals-card">
          <div className="reading-totals-value">
            {novelsStarted.toLocaleString('ru-RU')}
          </div>
          <div className="reading-totals-label">
            {pluralRu(novelsStarted, 'новелла', 'новеллы', 'новелл')} в чтении
          </div>
        </div>
        <div className="reading-totals-card">
          <div className="reading-totals-value">
            ≈ {estHoursRead.toLocaleString('ru-RU')}
          </div>
          <div className="reading-totals-label">
            {pluralRu(estHoursRead, 'час', 'часа', 'часов')} с книгой
          </div>
        </div>
        <div className="reading-totals-card reading-totals-card--translator">
          {favoriteTranslator ? (
            <>
              <div className="reading-totals-label reading-totals-label--top">
                Любимый переводчик
              </div>
              <div className="reading-totals-translator">
                {favoriteTranslator.slug ? (
                  <Link href={`/t/${favoriteTranslator.slug}`}>
                    {favoriteTranslator.name}
                  </Link>
                ) : (
                  <span>{favoriteTranslator.name}</span>
                )}
              </div>
              <div className="reading-totals-sub">
                {favoriteTranslator.chapters}{' '}
                {pluralRu(favoriteTranslator.chapters, 'глава', 'главы', 'глав')}
                {' '}у него/неё
              </div>
            </>
          ) : (
            <>
              <div className="reading-totals-label reading-totals-label--top">
                Любимый переводчик
              </div>
              <div className="reading-totals-sub">
                Появится, когда прочитаешь хотя бы одну новеллу переводчика.
              </div>
            </>
          )}
        </div>
      </div>
      <p className="reading-totals-note">
        Главы и часы — приблизительно: считаем по последней открытой главе
        в каждой новелле, одна глава ≈ 8 минут.
      </p>
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
