import Link from 'next/link';

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container">
        <p>
          © {new Date().getFullYear()} Chaptify &mdash; переводы от{' '}
          <Link href="https://tene.fun">tene.fun</Link>
        </p>
        <p style={{ marginTop: 6 }}>
          <Link href="/catalog">Каталог</Link>
          {' · '}
          <Link href="/news">Новости</Link>
          {' · '}
          <Link href="/help">Справка</Link>
          {' · '}
          <Link href="/profile">Профиль</Link>
        </p>
      </div>
    </footer>
  );
}
