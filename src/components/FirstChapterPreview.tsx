import Link from 'next/link';

interface Props {
  novelFirebaseId: string;
  firstChapterNumber: number;
  previewText: string;   // чистый текст, уже подрезанный и очищенный от html
  readingMinutes: number;
}

// Киллер-фича #1 страницы новеллы: превью первого абзаца главы прямо
// на странице. Снимает барьер «зайдёт или нет» до клика по «Читать».
export default function FirstChapterPreview({
  novelFirebaseId,
  firstChapterNumber,
  previewText,
  readingMinutes,
}: Props) {
  if (!previewText) return null;

  return (
    <section className="first-chapter-preview">
      <div className="fcp-head">
        <span className="fcp-eyebrow">Первые строки</span>
        <span className="fcp-duration">
          ≈ {readingMinutes} мин чтения до конца главы
        </span>
      </div>

      <blockquote className="fcp-body">
        <p>{previewText}</p>
      </blockquote>

      <div className="fcp-foot">
        <Link
          href={`/novel/${novelFirebaseId}/${firstChapterNumber}`}
          className="btn btn-primary"
        >
          Дочитать первую главу →
        </Link>
        <span className="fcp-note">Пропадёт после 30 секунд чтения в тексте</span>
      </div>
    </section>
  );
}
