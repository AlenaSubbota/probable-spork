import ReviewStars from './ReviewStars';

interface Props {
  avgRating: number;
  count: number;
}

// Компактный бейдж рейтинга на страницах профиля.
// Если отзывов нет — возвращаем null (ничего не показываем, нет мусора).
export default function ProfileRatingBadge({ avgRating, count }: Props) {
  if (count <= 0) return null;
  const rounded = Math.round(avgRating);

  return (
    <div className="profile-rating-badge" title={`Средняя оценка: ${avgRating} из 5`}>
      <ReviewStars value={rounded} size={14} />
      <span className="profile-rating-value">{avgRating.toFixed(1)}</span>
      <span className="profile-rating-count">
        · {count} {pluralRu(count, 'отзыв', 'отзыва', 'отзывов')}
      </span>
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
