import Link from 'next/link';

// Кастомная страница 404. Срабатывает на любой `notFound()` из
// server-компонентов и на несуществующие маршруты. Без этого Next
// отдаёт дефолтную страницу на английском с текстом "404 | This page
// could not be found." — на русскоязычном сайте режет глаз.
export default function NotFound() {
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
      <div style={{ fontSize: 56, lineHeight: 1 }} aria-hidden="true">📖</div>
      <h1 style={{ margin: 0, fontSize: 24, fontFamily: 'var(--font-serif)' }}>
        Страница не найдена
      </h1>
      <p style={{ maxWidth: 460, color: 'var(--ink-soft)', margin: 0, lineHeight: 1.5 }}>
        Может быть, новелла удалена или ссылка устарела. Проверь адрес
        или вернись в каталог — там точно что-то найдётся.
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link href="/" className="btn btn-primary">
          На главную
        </Link>
        <Link href="/catalog" className="btn btn-ghost">
          В каталог
        </Link>
      </div>
    </main>
  );
}
