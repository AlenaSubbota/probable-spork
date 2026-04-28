import Link from 'next/link';

// Подвал сайта. Состоит из двух зон:
//
// 1. Главная сетка: бренд (лого + строчка-таглайн) + три колонки ссылок
//    (Каталог / Сообщество / Сервис). Заголовки колонок — small-caps с
//    разрядкой, ссылки — мягкие, на hover уходят в --accent.
//
// 2. Нижняя строка: копирайт слева, юридические ссылки справа,
//    разделена тонкой рамкой сверху.

export default function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="container site-footer-grid">
        <div className="site-footer-brand">
          <Link href="/" className="logo" aria-label="Chaptify">
            <div className="logo-mark">C</div>
            Chaptify
          </Link>
          <p className="site-footer-tagline">
            Тихая библиотека для вечернего чтения.
            <br />
            Главы выходят, когда переводчики готовы — без спешки и шума.
          </p>
        </div>

        <nav className="site-footer-col" aria-label="Каталог">
          <h4 className="site-footer-head">Каталог</h4>
          <ul className="site-footer-links">
            <li>
              <Link href="/catalog?sort=new">Новинки</Link>
            </li>
            <li>
              <Link href="/catalog">По жанрам</Link>
            </li>
            <li>
              <Link href="/catalog">Подборки</Link>
            </li>
            <li>
              <Link href="/catalog">Авторы</Link>
            </li>
          </ul>
        </nav>

        <nav className="site-footer-col" aria-label="Сообщество">
          <h4 className="site-footer-head">Сообщество</h4>
          <ul className="site-footer-links">
            <li>
              <Link href="/feed">Лента</Link>
            </li>
            <li>
              <Link href="/translator/apply">Переводчикам</Link>
            </li>
            <li>
              <Link href="/help">Помощь</Link>
            </li>
          </ul>
        </nav>

        <nav className="site-footer-col" aria-label="Сервис">
          <h4 className="site-footer-head">Сервис</h4>
          <ul className="site-footer-links">
            <li>
              <Link href="/about">О проекте</Link>
            </li>
            <li>
              <Link href="/contacts">Контакты</Link>
            </li>
            <li>
              <Link href="/rules">Правила</Link>
            </li>
          </ul>
        </nav>
      </div>

      <div className="container site-footer-bottom">
        <div className="site-footer-copy">
          © {year} Chaptify · Спокойного чтения
        </div>
        <div className="site-footer-legal">
          <Link href="/terms">Условия</Link>
          <Link href="/privacy">Конфиденциальность</Link>
          <Link href="/cookies">Cookies</Link>
        </div>
      </div>
    </footer>
  );
}
