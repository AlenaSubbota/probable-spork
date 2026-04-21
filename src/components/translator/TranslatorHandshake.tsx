import Link from 'next/link';

interface Props {
  sharedReadsCount: number;
  totalNovels: number;
  topSharedTitles: string[];
  selfSlug: string | null;   // null если смотрит сам автор
}

// Киллер-фича #1 страницы переводчика: «Рукопожатие».
// Сколько новелл этого переводчика ты уже читал_а + маленький социальный сигнал.
export default function TranslatorHandshake({
  sharedReadsCount,
  totalNovels,
  topSharedTitles,
  selfSlug,
}: Props) {
  if (selfSlug) {
    return (
      <div className="handshake-card self">
        <div className="handshake-icon" aria-hidden="true">✎</div>
        <div>
          <strong>Это твоя страница.</strong>{' '}
          <Link href="/admin">Открой админку</Link>, чтобы редактировать профиль.
        </div>
      </div>
    );
  }

  if (sharedReadsCount === 0) {
    return (
      <div className="handshake-card dim">
        <div className="handshake-icon" aria-hidden="true">👀</div>
        <div>
          Ты ещё не читал_а ни одной новеллы этого переводчика.
          {totalNovels > 0 && <> У него(ё) {totalNovels} {pluralRu(totalNovels, 'новелла', 'новеллы', 'новелл')} — посмотри ниже.</>}
        </div>
      </div>
    );
  }

  const pct = totalNovels > 0 ? Math.round((sharedReadsCount / totalNovels) * 100) : 0;

  return (
    <div className="handshake-card">
      <div className="handshake-icon" aria-hidden="true">🤝</div>
      <div>
        <strong>
          Вы уже совпали на {sharedReadsCount} {pluralRu(sharedReadsCount, 'новелле', 'новеллах', 'новеллах')}
        </strong>
        {totalNovels > 0 && pct > 0 && <> · {pct}% от каталога переводчика</>}
        {topSharedTitles.length > 0 && (
          <div className="handshake-titles">
            {topSharedTitles.slice(0, 3).join(' · ')}
          </div>
        )}
      </div>
    </div>
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
