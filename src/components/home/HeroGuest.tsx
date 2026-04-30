import Link from 'next/link';

// Гостевой герой: показывается только незалогиненному визитёру.
// Задача — за 2 секунды объяснить «что это» и куда тыкнуть. Без
// маркетинговой воды, в духе бренда: камерно, тепло, иероглиф-метка.
//
// Композиция: левая колонка — заголовок + слоган + поиск + чипы стран,
// правая — декоративный «окошко в книгу» (на узких экранах прячется).

export default function HeroGuest() {
  return (
    <section className="hero-guest">
      <div className="container hero-guest-inner">
        <div className="hero-guest-copy">
          <span className="hero-guest-eyebrow">
            <span className="hero-guest-eyebrow-mark" aria-hidden="true">茶</span>
            Chaptify · азиатские новеллы по-русски
          </span>
          <h1 className="hero-guest-title">
            Корея. Китай. Япония.
            <br />
            <span className="hero-guest-title-soft">Глава за главой —</span>{' '}
            <em>в человеческом переводе.</em>
          </h1>
          <p className="hero-guest-lead">
            Кураторский каталог любительских и профессиональных переводов.
            Без рекламы внутри глав, с уважением к оригиналу.
          </p>

          <form action="/search" method="get" className="hero-guest-search" role="search">
            <span className="hero-guest-search-icon" aria-hidden="true">⌕</span>
            <input
              type="search"
              name="q"
              placeholder="Название, автор или герой…"
              aria-label="Поиск по новеллам"
              className="hero-guest-search-input"
              autoComplete="off"
            />
            <button type="submit" className="hero-guest-search-btn">
              Найти
            </button>
          </form>

          <div className="hero-guest-chips">
            <span className="hero-guest-chips-label">Или сразу:</span>
            <Link href="/catalog?country=kr" className="hero-guest-chip">
              <span aria-hidden="true">🇰🇷</span> Корея
            </Link>
            <Link href="/catalog?country=cn" className="hero-guest-chip">
              <span aria-hidden="true">🇨🇳</span> Китай
            </Link>
            <Link href="/catalog?country=jp" className="hero-guest-chip">
              <span aria-hidden="true">🇯🇵</span> Япония
            </Link>
            <Link href="/catalog" className="hero-guest-chip hero-guest-chip-ghost">
              Весь каталог →
            </Link>
          </div>
        </div>

        <div className="hero-guest-art" aria-hidden="true">
          <div className="hero-guest-art-page">
            <div className="hero-guest-art-line" style={{ width: '78%' }} />
            <div className="hero-guest-art-line" style={{ width: '92%' }} />
            <div className="hero-guest-art-line" style={{ width: '64%' }} />
            <div className="hero-guest-art-line hero-guest-art-line-gap" />
            <div className="hero-guest-art-line" style={{ width: '88%' }} />
            <div className="hero-guest-art-line" style={{ width: '70%' }} />
            <div className="hero-guest-art-line" style={{ width: '55%' }} />
            <div className="hero-guest-art-stamp">章</div>
          </div>
        </div>
      </div>
    </section>
  );
}
