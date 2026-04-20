import Link from 'next/link';

export default function ProfilePage() {
  return (
    <main className="container section">
      {/* Шапка профиля */}
      <div className="profile-hero">
        <div className="big-avatar">A</div>
        <div>
          <h2>Алёна</h2>
          <div className="handle">@alena_subbota</div>
        </div>
      </div>

      {/* Статистика */}
      <div className="card-grid-3">
        <div className="stat-card">
          <div className="label">Баланс</div>
          <div className="value">
            248 <small>монет</small>
          </div>
        </div>
        <div className="stat-card">
          <div className="label">Куплено глав</div>
          <div className="value">42</div>
        </div>
        <div className="stat-card">
          <div className="label">Подписки</div>
          <div className="value">1 <small>активна</small></div>
        </div>
      </div>

      {/* Подписки и Читаю сейчас */}
      <div className="hero-grid">
        <div className="card">
          <h3>Мои подписки</h3>
          <div className="sub-item">
            <div className="who">А</div>
            <div className="body">
              <div className="name">Алёна (Boosty)</div>
              <div className="line">До 3 мая 2024</div>
            </div>
            <span className="status-pill status-active">Активна</span>
          </div>
          <div className="sub-item">
            <div className="who" style={{ background: '#E3EBD6', color: '#4C6A34' }}>И</div>
            <div className="body">
              <div className="name">Иван (Tribute)</div>
              <div className="line">Истекла 10 апреля</div>
            </div>
            <span className="status-pill status-expired">Истекла</span>
          </div>
        </div>

        <div className="card">
          <h3>Читаю сейчас</h3>
          <div className="reading-row">
            <div className="mini-cover p1"></div>
            <div>
              <div style={{ fontWeight: 600, fontSize: '14px' }}>Лунные песни осеннего двора</div>
              <div style={{ fontSize: '12px', color: 'var(--ink-mute)' }}>Глава 14 из 124</div>
              <div className="progress"><span style={{ width: '15%' }}></span></div>
            </div>
            <button className="btn btn-ghost" style={{ padding: '0 12px', height: '32px' }}>→</button>
          </div>
        </div>
      </div>

      {/* История транзакций */}
      <div className="card">
        <h3>История операций</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <tbody>
            <tr style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '12px 0', color: 'var(--ink-mute)' }}>15 апр.</td>
              <td>Пополнение через Tribute</td>
              <td style={{ textAlign: 'right', color: '#4C6A34', fontWeight: 600 }}>+300</td>
            </tr>
            <tr style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '12px 0', color: 'var(--ink-mute)' }}>3 апр.</td>
              <td>Подписка на Алёну (Boosty)</td>
              <td style={{ textAlign: 'right', color: 'var(--ink-mute)' }}>299 ₽</td>
            </tr>
            <tr style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '12px 0', color: 'var(--ink-mute)' }}>2 апр.</td>
              <td>Покупка главы 203 «Кольцо южных волн»</td>
              <td style={{ textAlign: 'right', color: 'var(--accent-hover)', fontWeight: 600 }}>−10</td>
            </tr>
          </tbody>
        </table>
      </div>
    </main>
  );
}