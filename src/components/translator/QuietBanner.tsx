interface Props {
  quietUntil: string;
  quietNote: string | null;
  translatorName: string;
}

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

// Деликатный баннер «переводчик восстанавливается» вместо холодного
// «давно не было глав». Уважительный тон: читатель понимает, что это
// не заброс, а пауза.
export default function QuietBanner({ quietUntil, quietNote, translatorName }: Props) {
  const d = new Date(quietUntil);
  if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) return null;

  const untilLabel = `${d.getDate()} ${MONTHS[d.getMonth()]}`;

  return (
    <aside className="quiet-banner">
      <div className="quiet-banner-icon" aria-hidden="true">☕</div>
      <div className="quiet-banner-body">
        <div className="quiet-banner-title">
          {translatorName} на тихом режиме до {untilLabel}
        </div>
        <div className="quiet-banner-sub">
          {quietNote ??
            'Пауза — не заброс. Вернётся, как только будет ресурс. Новые главы в это время не выходят.'}
        </div>
      </div>
    </aside>
  );
}
