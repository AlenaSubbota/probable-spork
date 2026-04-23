import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';

export const metadata = {
  title: 'Как пополнить монеты — Chaptify',
};

// Раньше на этой странице была «общая» покупка монет для платформы.
// После мигр. 045 модель сменилась: у каждого переводчика — свой кошелёк,
// и пополняется он на его странице `/t/[slug]`. Эта страница теперь —
// гайд «как это работает» + список переводчиков, у которых у читателя
// уже есть баланс.
export default async function TopupPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Активные кошельки (где есть ненулевой баланс)
  let wallets: Array<{
    translator_id: string;
    name: string;
    slug: string | null;
    avatar_url: string | null;
    balance: number;
  }> = [];
  try {
    const { data } = await supabase.rpc('my_translator_wallets');
    if (Array.isArray(data)) {
      wallets = (data as Array<{
        translator_id: string;
        user_name: string | null;
        translator_slug: string | null;
        translator_display_name: string | null;
        translator_avatar_url: string | null;
        avatar_url: string | null;
        balance: number;
      }>).map((w) => ({
        translator_id: w.translator_id,
        name: w.translator_display_name || w.user_name || 'Переводчик',
        slug: w.translator_slug || w.user_name || null,
        avatar_url: w.translator_avatar_url || w.avatar_url || null,
        balance: w.balance,
      }));
    }
  } catch {
    /* миграция 045 не накачена */
  }

  return (
    <main className="container section" style={{ maxWidth: 820 }}>
      <div className="admin-breadcrumbs">
        <Link href="/profile">Профиль</Link>
        <span>/</span>
        <span>Монеты</span>
      </div>

      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-serif)', margin: '0 0 8px' }}>
          Как монеты работают
        </h1>
        <p style={{ color: 'var(--ink-soft)', lineHeight: 1.5, margin: 0 }}>
          Chaptify не проводит деньги между читателем и переводчиком. Каждый
          переводчик принимает оплату сам — через Boosty / Tribute / VK Donut /
          карту (как самозанятый или ИП). Монеты на сайте — это просто учёт:
          «читатель X оплатил переводчику Y вперёд, и у них есть лицевой счёт
          на N монет».
        </p>
      </header>

      <section className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 10px' }}>Как купить монеты у переводчика</h3>
        <ol style={{ paddingLeft: 18, lineHeight: 1.7, color: 'var(--ink-soft)' }}>
          <li>
            Зайди на страницу переводчика — по ссылке из карточки новеллы или{' '}
            <code>/t/&lt;ник&gt;</code>.
          </li>
          <li>
            Нажми «Пополнить» в блоке «кошелёк у этого переводчика». Выбери
            сколько монет покупаешь (100, 300, 1000 или своя сумма) и платформу.
          </li>
          <li>
            Переведи переводчику деньги тем способом, который он принимает.
            В комментарии к переводу напиши показанный сайтом код.
          </li>
          <li>
            Переводчик сверит платёж со своим банком / Boosty и нажмёт
            «Одобрить» в админке. Монеты появятся у тебя на балансе этого
            переводчика.
          </li>
          <li>
            Трать на его платные главы — кнопка «Купить за N монет» на paywall.
          </li>
        </ol>
      </section>

      <section className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 10px' }}>Важные нюансы</h3>
        <ul style={{ paddingLeft: 18, lineHeight: 1.7, color: 'var(--ink-soft)' }}>
          <li>
            Монеты одного переводчика <strong>не работают</strong> на новеллах
            другого. Кошелёк всегда per-translator — как подарочная карта
            конкретного магазина.
          </li>
          <li>
            Деньги идут <strong>только</strong> напрямую переводчику. Chaptify
            кассу не держит и выплаты не делает.
          </li>
          <li>
            Если переводчик принимает только подписки (монеты за главы выключены
            в его профиле) — оформляй месячную подписку на его Boosty / Tribute.
          </li>
          <li>
            Вернуть деньги за монеты можно только напрямую у переводчика.
          </li>
        </ul>
      </section>

      {wallets.length > 0 && (
        <section className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 12px' }}>Твои кошельки</h3>
          <div className="wallets-grid">
            {wallets.map((w) => {
              const href = w.slug ? `/t/${w.slug}` : `/u/${w.translator_id}`;
              const initial = w.name.trim().charAt(0).toUpperCase() || '?';
              return (
                <Link key={w.translator_id} href={href} className="wallet-card">
                  <div className="wallet-card-avatar">
                    {w.avatar_url ? <img src={w.avatar_url} alt="" /> : <span>{initial}</span>}
                  </div>
                  <div>
                    <div className="wallet-card-name">{w.name}</div>
                    <div className="wallet-card-balance">
                      {w.balance} <small>монет · пополнить →</small>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <Link href="/catalog" className="btn btn-ghost">
        Найти переводчика в каталоге
      </Link>
    </main>
  );
}
