import Link from 'next/link';

export default function CatalogPage() {
  return (
    <main className="container section">
      <h1>Каталог новелл</h1>
      <p style={{ color: 'var(--ink-mute)' }}>Здесь скоро появятся фильтры по жанрам, статусу и переводчикам.</p>
      <Link href="/" className="more">← На главную</Link>
    </main>
  );
}