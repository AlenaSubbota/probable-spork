'use client';

// Звёздная шкала 1-5. Если interactive=true — клик меняет выбор.
// Без svg-иконок: текстовые звёзды (★/☆), чтобы не тянуть иконочный лишний
// компонент и не ломать шрифт.

interface Props {
  value: number;             // 0..5; 0 = «не выбрано»
  onChange?: (v: number) => void;
  size?: number;             // в пикселях
  title?: string;
}

export default function ReviewStars({ value, onChange, size = 18, title }: Props) {
  const readonly = !onChange;
  return (
    <div
      className={`review-stars${readonly ? '' : ' review-stars--interactive'}`}
      role={readonly ? 'img' : 'radiogroup'}
      aria-label={title ?? `Оценка: ${value} из 5`}
      style={{ fontSize: size }}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= value;
        return readonly ? (
          <span key={n} aria-hidden="true" className={filled ? 'is-filled' : ''}>
            {filled ? '★' : '☆'}
          </span>
        ) : (
          <button
            type="button"
            key={n}
            role="radio"
            aria-checked={n === value}
            aria-label={`${n} звёзд${n === 1 ? 'а' : n < 5 ? 'ы' : ''}`}
            onClick={() => onChange!(n)}
            className={`review-stars-btn${filled ? ' is-filled' : ''}`}
          >
            {filled ? '★' : '☆'}
          </button>
        );
      })}
    </div>
  );
}
