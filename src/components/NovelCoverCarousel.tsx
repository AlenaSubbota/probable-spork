'use client';

import { useState, useRef } from 'react';

interface Props {
  covers: string[];          // [главная, доп1, доп2, …]
  alt: string;
  /** Заглушка на случай если нет обложек — передаётся извне. */
  placeholder?: React.ReactNode;
}

// Мини-карусель для NovelCard: пролистываешь обложки новеллы свайпом
// или кликом по dots. Если обложка одна — карусель не показывается,
// рендерится просто <img>. Работает и на мобиле (touch), и на десктопе
// (hover + кнопки).
export default function NovelCoverCarousel({ covers, alt, placeholder }: Props) {
  const [index, setIndex] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef<number | null>(null);

  const total = covers.length;
  const cur = covers[index];

  const goto = (i: number) => {
    if (i < 0) i = total - 1;
    if (i >= total) i = 0;
    setIndex(i);
  };

  // Touch swipe
  const onTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    setDragging(true);
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (startX.current === null) return;
    const delta = e.changedTouches[0].clientX - startX.current;
    startX.current = null;
    setDragging(false);
    if (Math.abs(delta) < 30) return;
    goto(delta < 0 ? index + 1 : index - 1);
  };

  if (total === 0) {
    return <>{placeholder}</>;
  }

  return (
    <div
      className="novel-cover-carousel"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => {
        startX.current = null;
        setDragging(false);
      }}
    >
      {cur ? (
        <img
          src={cur}
          alt={alt}
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transition: dragging ? 'none' : 'transform .15s',
          }}
        />
      ) : (
        placeholder
      )}

      {total > 1 && (
        <>
          {/* Боковые кнопки на десктопе / больших тачах — для мобиля
              остаётся свайп + dots */}
          <button
            type="button"
            className="cover-carousel-btn cover-carousel-btn--prev"
            aria-label="Предыдущая обложка"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              goto(index - 1);
            }}
          >
            ‹
          </button>
          <button
            type="button"
            className="cover-carousel-btn cover-carousel-btn--next"
            aria-label="Следующая обложка"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              goto(index + 1);
            }}
          >
            ›
          </button>

          <div className="cover-carousel-dots" aria-hidden="true">
            {covers.map((_, i) => (
              <span
                key={i}
                className={`cover-carousel-dot${i === index ? ' is-active' : ''}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
