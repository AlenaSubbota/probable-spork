import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import TopupPackages from './TopupPackages';
import { timeAgo } from '@/lib/format';

export const metadata = {
  title: 'Пополнить баланс — Chaptify',
};

export default async function TopupPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profileRaw } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  const profile = (profileRaw ?? {}) as {
    coin_balance?: number | null;
    payment_code?: string | null;
  };

  const balance = typeof profile.coin_balance === 'number' ? profile.coin_balance : 0;

  // Берём код платежа из профиля; если нет — используем короткую часть id
  const paymentCode = profile.payment_code ?? `C-${user.id.slice(0, 8).toUpperCase()}`;

  // Последние транзакции по монетам
  let transactions: Array<{
    id: number;
    amount: number;
    reason: string;
    created_at: string;
  }> = [];
  try {
    const { data } = await supabase
      .from('coin_transactions')
      .select('id, amount, reason, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(15);
    transactions = data ?? [];
  } catch {
    // таблица может ещё не существовать — миграция 001 не накачена
  }

  // На этот этап демо: берём дефолтные провайдерские ссылки из env
  // (переводчики могут позже настроить свои в профиле)
  const tributeChannel = process.env.NEXT_PUBLIC_TRIBUTE_CHANNEL ?? 'tribute';
  const boostyUrl = process.env.NEXT_PUBLIC_BOOSTY_URL ?? '';

  return (
    <main className="container section topup-page">
      <div className="admin-breadcrumbs">
        <Link href="/profile">Профиль</Link>
        <span>/</span>
        <span>Пополнить</span>
      </div>

      <header className="topup-head">
        <div>
          <h1>Пополнить баланс</h1>
          <p className="admin-head-sub">
            Монеты открывают любые платные главы — у любого переводчика, сразу.
          </p>
        </div>
        <div className="topup-balance">
          <div className="topup-balance-label">Сейчас на счету</div>
          <div className="topup-balance-value">
            {balance.toLocaleString('ru-RU')}{' '}
            <span className="topup-balance-unit">монет</span>
          </div>
        </div>
      </header>

      <div className="topup-layout">
        <div className="topup-main">
          <TopupPackages
            tributeChannel={tributeChannel}
            boostyUrl={boostyUrl}
            paymentCode={paymentCode}
          />
        </div>

        <aside className="topup-side">
          <h3 style={{ fontFamily: 'var(--font-serif)', margin: '0 0 12px', fontSize: 16 }}>
            История операций
          </h3>
          {transactions.length === 0 ? (
            <p style={{ color: 'var(--ink-mute)', fontSize: 13 }}>
              Ещё ничего не было. Купи первый пакет — появится здесь.
            </p>
          ) : (
            <div className="topup-tx-list">
              {transactions.map((t) => (
                <div key={t.id} className="topup-tx-row">
                  <div className="topup-tx-body">
                    <div className="topup-tx-reason">
                      {reasonLabel(t.reason)}
                    </div>
                    <div className="topup-tx-time">{timeAgo(t.created_at)}</div>
                  </div>
                  <div
                    className={`topup-tx-amount${t.amount > 0 ? ' positive' : t.amount < 0 ? ' negative' : ''}`}
                  >
                    {t.amount > 0 ? '+' : ''}{t.amount}
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

function reasonLabel(reason: string): string {
  switch (reason) {
    case 'tribute_topup': return 'Пополнение через Tribute';
    case 'boosty_topup':  return 'Пополнение через Boosty';
    case 'chapter_purchase': return 'Покупка главы';
    case 'admin_adjust': return 'Корректировка (админ)';
    default: return reason;
  }
}
