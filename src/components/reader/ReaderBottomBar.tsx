'use client';

import Link from 'next/link';

interface Props {
  // Прогресс
  readMode: 'pages' | 'scroll';
  currentPage: number;       // 0-based, для pages
  totalPages: number;        // ≥1, для pages
  scrollPercent: number;     // 0..100, для scroll

  // Соседние главы (полностью адресные, для prefetch и SSR-навигации)
  novelFirebaseId: string | null;
  prevChapterNumber: number | null;
  nextChapterNumber: number | null;

  // Действия
  onSeekPage: (idx: number) => void;        // только pages
  onSeekScroll: (percent: number) => void;  // только scroll
  onPrevPage: () => void;                   // только pages: предыдущая страница внутри главы
  onNextPage: () => void;                   // только pages: следующая страница внутри главы
  onOpenTOC: () => void;
  onOpenSettings: () => void;
  onJumpToComments: () => void;
  commentCount: number | null;

  // Иммерсив: скрывается по тапу по центру, через CSS
  visible: boolean;
}

// Большая нижняя панель управления читалкой (как в tene). Заменяет старый
// маленький .reader-toolbar сверху. Прилипает к низу экрана, в pages-режиме
// показывает «Стр. X из Y» и тонкий слайдер прогресса; в scroll — «N%».
//
// Логика prev-chapter с goToLastPage: на первой странице pages-режима
// клик «‹ chapter prev» уносит на /novel/<id>/<prev>?end=1 — там читалка
// доскроллит до последней страницы. Если не на первой странице — кнопка
// перелистывает на одну страницу назад внутри текущей главы.
export default function ReaderBottomBar({
  readMode,
  currentPage,
  totalPages,
  scrollPercent,
  novelFirebaseId,
  prevChapterNumber,
  nextChapterNumber,
  onSeekPage,
  onSeekScroll,
  onPrevPage,
  onNextPage,
  onOpenTOC,
  onOpenSettings,
  onJumpToComments,
  commentCount,
  visible,
}: Props) {
  const isPages = readMode === 'pages';
  const atFirstPage = isPages ? currentPage === 0 : true;
  const atLastPage = isPages ? currentPage >= totalPages - 1 : true;

  // Куда ведёт кнопка ◀: либо на предыдущую страницу (pages, не первая),
  // либо на предыдущую главу. ?end=1 (стартуем там с конца) только в
  // pages-режиме, где переход «назад» = «продолжить листать справа
  // налево». В scroll-режиме читатель ожидает, что прошлая глава
  // откроется с заголовка, а не у самого низа — иначе непонятно,
  // куда листать дальше.
  const prevHref =
    !isPages || atFirstPage
      ? prevChapterNumber !== null && novelFirebaseId
        ? isPages
          ? `/novel/${novelFirebaseId}/${prevChapterNumber}?end=1`
          : `/novel/${novelFirebaseId}/${prevChapterNumber}`
        : null
      : null;

  // Куда ведёт ▶: следующая страница (pages, не последняя), иначе следующая глава.
  const nextHref =
    !isPages || atLastPage
      ? nextChapterNumber !== null && novelFirebaseId
        ? `/novel/${novelFirebaseId}/${nextChapterNumber}`
        : null
      : null;

  return (
    <div
      className={`reader-bottom-bar${visible ? '' : ' is-hidden'}`}
      role="toolbar"
      aria-label="Управление чтением"
    >
      <div className="reader-bottom-bar-inner">
        {/* Прогресс — текст + слайдер */}
        <div className="rbb-progress">
          <div className="rbb-progress-text">
            {isPages ? (
              <>
                <span>Стр. {Math.min(currentPage + 1, totalPages)}</span>
                <span className="rbb-progress-text-sep">·</span>
                <span>из {totalPages}</span>
              </>
            ) : (
              <>
                <span>Прогресс</span>
                <span className="rbb-progress-text-sep">·</span>
                <span>{Math.round(scrollPercent)}%</span>
              </>
            )}
          </div>
          <input
            type="range"
            className="rbb-progress-bar"
            min={0}
            max={isPages ? Math.max(0, totalPages - 1) : 100}
            value={isPages ? Math.min(currentPage, totalPages - 1) : scrollPercent}
            // CSS-переменная --rbb-fill даёт визуальную «заливку» трека
            // от 0 до текущей позиции (см. globals.css). Без неё
            // пользователь видит только thumb, и кажется что прогресс
            // «не работает».
            style={{
              ['--rbb-fill' as string]: `${
                isPages
                  ? totalPages > 1
                    ? Math.round((Math.min(currentPage, totalPages - 1) / (totalPages - 1)) * 100)
                    : 0
                  : Math.round(scrollPercent)
              }%`,
            }}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (isPages) onSeekPage(val);
              else onSeekScroll(val);
            }}
            // После касания/отпускания мыши блюрим, чтобы клавиатурные
            // стрелки сразу листали текст, а не двигали слайдер ещё раз.
            onPointerUp={(e) => (e.currentTarget as HTMLInputElement).blur()}
            onTouchEnd={(e) => (e.currentTarget as HTMLInputElement).blur()}
            aria-label="Прогресс по главе"
          />
        </div>

        {/* Кнопки навигации */}
        <div className="rbb-actions">
          {/* ◀ prev: либо на пред.страницу внутри главы, либо на пред.главу */}
          {isPages && !atFirstPage ? (
            <button
              type="button"
              className="rbb-btn rbb-btn-edge"
              onClick={onPrevPage}
              aria-label="Предыдущая страница"
              title="← или PgUp"
            >
              ‹
            </button>
          ) : prevHref ? (
            <Link
              href={prevHref}
              className="rbb-btn rbb-btn-edge"
              prefetch
              aria-label={`Предыдущая глава ${prevChapterNumber}`}
              title={`Предыдущая глава ${prevChapterNumber}`}
            >
              ‹
              <span className="rbb-btn-sub">гл.</span>
            </Link>
          ) : (
            <button
              type="button"
              className="rbb-btn rbb-btn-edge"
              disabled
              aria-label="Предыдущая глава"
            >
              ‹
            </button>
          )}

          {/* Центр: TOC, Settings, Comments */}
          <div className="rbb-center">
            <button
              type="button"
              className="rbb-btn"
              onClick={onOpenTOC}
              aria-label="Оглавление"
              title="Оглавление"
            >
              ≡
              <span className="rbb-btn-label">Главы</span>
            </button>
            <button
              type="button"
              className="rbb-btn"
              onClick={onOpenSettings}
              aria-label="Настройки чтения"
              title="Настройки"
            >
              ⚙
              <span className="rbb-btn-label">Настройки</span>
            </button>
            <button
              type="button"
              className="rbb-btn rbb-btn-comments"
              onClick={onJumpToComments}
              aria-label="К комментариям"
              title="К комментариям"
            >
              💬
              {commentCount !== null && commentCount > 0 && (
                <span className="rbb-btn-count">{commentCount}</span>
              )}
            </button>
          </div>

          {/* ▶ next: либо след.страница, либо след.глава */}
          {isPages && !atLastPage ? (
            <button
              type="button"
              className="rbb-btn rbb-btn-edge rbb-btn-next"
              onClick={onNextPage}
              aria-label="Следующая страница"
              title="→ или PgDn"
            >
              ›
            </button>
          ) : nextHref ? (
            <Link
              href={nextHref}
              className="rbb-btn rbb-btn-edge rbb-btn-next"
              prefetch
              aria-label={`Следующая глава ${nextChapterNumber}`}
              title={`Следующая глава ${nextChapterNumber}`}
            >
              <span className="rbb-btn-sub">гл.</span>
              ›
            </Link>
          ) : (
            <button
              type="button"
              className="rbb-btn rbb-btn-edge rbb-btn-next"
              disabled
              aria-label="Следующая глава"
            >
              ›
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
