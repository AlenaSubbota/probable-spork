'use client';

// global-error.tsx срабатывает на ошибках в самом root layout (или его
// детях верхнего уровня), когда обычный error.tsx уже не может ничего
// показать — потому что layout сломался. Должен включать в себя
// собственные <html> и <body>.
//
// Контракт Next.js: у global-error НЕТ доступа к стилям/CSS-переменным
// сайта (layout не загрузился), поэтому всё в inline-стилях.
import { useEffect } from 'react';

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[global-error]', error);
  }, [error]);

  return (
    <html lang="ru">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 20px',
          textAlign: 'center',
          gap: 16,
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          background: '#F5EFE6',
          color: '#2A1F14',
        }}
      >
        <div style={{ fontSize: 64, lineHeight: 1 }} aria-hidden="true">⚠️</div>
        <h1 style={{ margin: 0, fontSize: 28 }}>Сайт временно недоступен</h1>
        <p style={{ maxWidth: 460, margin: 0, lineHeight: 1.5, opacity: 0.8 }}>
          Что-то пошло не так на нашей стороне. Попробуй обновить страницу
          через минуту.
        </p>
        {error.digest && (
          <p style={{ fontSize: 12, opacity: 0.6, margin: 0 }}>
            Код: <code>{error.digest}</code>
          </p>
        )}
        <button
          type="button"
          onClick={() => location.reload()}
          style={{
            marginTop: 8,
            padding: '10px 20px',
            background: '#2A1F14',
            color: '#F5EFE6',
            border: 'none',
            borderRadius: 6,
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          ↻ Обновить
        </button>
      </body>
    </html>
  );
}
