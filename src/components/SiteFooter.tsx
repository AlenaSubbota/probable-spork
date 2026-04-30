import Link from 'next/link';

// Подвал в стиле книжного колофона: центрированный фронтиспис с лого,
// краткий слоган в serif italic, орнаментальный разделитель «✦», ряд
// основных навигационных ссылок через бул-точки и строка низа с
// копирайтом и юр-ссылками. Без 4-колоночной сетки — на узких экранах
// она выглядела дёшево и грузно.

const PRIMARY_LINKS: Array<{ href: string; label: string }> = [
  { href: '/catalog', label: 'Каталог' },
  { href: '/collections', label: 'Подборки' },
  { href: '/feed', label: 'Лента' },
  { href: '/news', label: 'Журнал' },
  { href: '/translator/apply', label: 'Переводчикам' },
  { href: '/help', label: 'Помощь' },
];

const LEGAL_LINKS: Array<{ href: string; label: string }> = [
  { href: '/terms', label: 'Условия' },
  { href: '/privacy', label: 'Конфиденциальность' },
  { href: '/cookies', label: 'Cookies' },
];

export default function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="container site-footer-colophon">
        <Link href="/" className="site-footer-mark" aria-label="Chaptify">
          <span className="site-footer-mark-square" aria-hidden="true">C</span>
          <span className="site-footer-mark-name">Chaptify</span>
        </Link>

        <p className="site-footer-tagline">
          Азиатские новеллы по-русски —
          <br />
          главами, в человеческом переводе.
        </p>

        <div className="site-footer-ornament" aria-hidden="true">
          <span className="site-footer-ornament-rule" />
          <span className="site-footer-ornament-glyph">✦</span>
          <span className="site-footer-ornament-rule" />
        </div>

        <nav className="site-footer-primary" aria-label="Основная навигация">
          {PRIMARY_LINKS.map((l, i) => (
            <span key={l.href} className="site-footer-primary-item">
              {i > 0 && <span className="site-footer-dot" aria-hidden="true">·</span>}
              <Link href={l.href}>{l.label}</Link>
            </span>
          ))}
        </nav>

        <div className="site-footer-tail">
          <span className="site-footer-copy">
            © {year} Chaptify · переводы от{' '}
            <Link href="https://tene.fun" className="site-footer-by">
              tene.fun
            </Link>
          </span>
          <nav className="site-footer-legal" aria-label="Юридическая информация">
            {LEGAL_LINKS.map((l, i) => (
              <span key={l.href} className="site-footer-legal-item">
                {i > 0 && <span className="site-footer-dot" aria-hidden="true">·</span>}
                <Link href={l.href}>{l.label}</Link>
              </span>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
