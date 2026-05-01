'use client';

// Глобальный error-boundary для App Router. Показывается при любой
// необработанной ошибке в server / client компонентах (кроме layout/template).
// До этого PR Next отдавал дефолтную страницу на ENGLISH с текстом
// "Application error" — на русскоязычном сайте это сразу выглядит как
// «всё сломалось», даже если упало что-то совсем мелкое.
//
// Должен быть client-component (директива выше).
import { useEffect } from 'react';
import Link from 'next/link';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // На сервере уже залогировано; здесь дублируем в браузерную консоль
    // чтобы было видно при дебаге.
    // eslint-disable-next-line no-console
    console.error('[app-error]', error);
  }, [error]);

  return (
    <main
      style={{
        minHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 20px',
        textAlign: 'center',
        gap: 16,
      }}
    >
      <div style={{ fontSize: 56, lineHeight: 1 }} aria-hidden="true">⚠️</div>
      <h1 style={{ margin: 0, fontSize: 24, fontFamily: 'var(--font-serif)' }}>
        Что-то сломалось
      </h1>
      <p style={{ maxWidth: 460, color: 'var(--ink-soft)', margin: 0, lineHeight: 1.5 }}>
        Извини, не получилось загрузить страницу. Можно попробовать снова —
        чаще всего помогает. Если ошибка повторяется, напиши через{' '}
        <Link href="/contacts" style={{ color: 'var(--accent)' }}>
          форму обратной связи
        </Link>
        .
      </p>
      {error.digest && (
        <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: 0 }}>
          Код ошибки: <code>{error.digest}</code>
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => reset()}
        >
          ↻ Попробовать снова
        </button>
        <Link href="/" className="btn btn-ghost">
          На главную
        </Link>
      </div>
    </main>
  );
}
