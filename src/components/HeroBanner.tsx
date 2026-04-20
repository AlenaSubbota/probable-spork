import Link from 'next/link';

export default function HeroBanner() {
  return (
    <section className="container hero">
      <div className="hero-grid">
        <div className="hero-card">
          <span className="note">Новое на Chaptify</span>
          <h1>Два переводчика — одна платформа</h1>
          <p>Выбирай любимого переводчика, оформляй подписку или покупай главы штучно за монетки. Прогресс чтения синхронизируется с приложением в Telegram.</p>
          <div className="actions-row">
            <Link href="/catalog" className="btn btn-primary">Открыть каталог</Link>
            <Link href="/profile" className="btn btn-ghost">Пополнить баланс</Link>
          </div>
        </div>
        <div className="hero-side">
          <div className="hero-card">
            <span className="note">Алёна</span>
            <h3>42 новеллы · 1 284 глав</h3>
            <p style={{ margin: 0, color: 'var(--ink-mute)', fontSize: '13px' }}>Ромфэнтези и современные корейские новеллы.</p>
          </div>
          <div className="hero-card">
            <span className="note" style={{ background: '#E3EBD6', color: '#4C6A34' }}>Иван</span>
            <h3>17 новелл · 308 глав</h3>
            <p style={{ margin: 0, color: 'var(--ink-mute)', fontSize: '13px' }}>Уся и сянься, тёмное фэнтези.</p>
          </div>
        </div>
      </div>
    </section>
  );
}