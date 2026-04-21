import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import AllPayoutsClient from './AllPayoutsClient';

export const metadata = { title: 'Выплаты переводчикам — Chaptify' };

interface PageProps {
  searchParams: Promise<{ period?: string }>;
}

function monthRange(periodKey: string | undefined): { from: string; to: string; label: string } {
  const now = new Date();
  const year = now.getFullYear();
  let month = now.getMonth(); // 0-11; текущий

  if (periodKey && /^\d{4}-\d{2}$/.test(periodKey)) {
    const [y, m] = periodKey.split('-').map((x) => parseInt(x, 10));
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 1));
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      label: from.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }),
    };
  }

  const from = new Date(Date.UTC(year, month, 1));
  const to = new Date(Date.UTC(year, month + 1, 1));
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    label: from.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }),
  };
}

// 12 последних месяцев включая текущий
function monthOptions(): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() - i, 1));
    out.push({
      key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }),
    });
  }
  return out;
}

export default async function AllPayoutsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  const p = profile as { role?: string; is_admin?: boolean } | null;
  const isAdmin = p?.is_admin === true || p?.role === 'admin';
  if (!isAdmin) redirect('/admin');

  const range = monthRange(sp.period);
  const months = monthOptions();
  const currentKey = sp.period ?? months[0].key;

  let rows: Array<{
    translator_id: string;
    translator_name: string;
    translator_slug: string | null;
    coins_gross: number;
    chapter_count: number;
    unique_buyers: number;
    payout_method: string | null;
    payout_ref: string | null;
  }> = [];
  try {
    const { data } = await supabase.rpc('all_translators_earnings', {
      p_from: range.from,
      p_to: range.to,
    });
    if (Array.isArray(data)) rows = data;
  } catch {
    // миграция 011 не накачена
  }

  // Закрытые циклы за этот период
  let paidCycles: Array<{
    translator_id: string;
    amount_rub: number;
    paid_at: string | null;
  }> = [];
  try {
    const { data } = await supabase
      .from('payout_cycles')
      .select('translator_id, amount_rub, paid_at')
      .gte('period_from', range.from)
      .lt('period_to', range.to);
    paidCycles = (data ?? []) as typeof paidCycles;
  } catch {
    // ok
  }
  const paidMap = new Map<string, { rub: number; paid: boolean }>();
  for (const c of paidCycles) {
    const prev = paidMap.get(c.translator_id) ?? { rub: 0, paid: false };
    paidMap.set(c.translator_id, {
      rub: prev.rub + Number(c.amount_rub),
      paid: prev.paid || !!c.paid_at,
    });
  }

  const totalCoins = rows.reduce((s, r) => s + Number(r.coins_gross), 0);

  return (
    <main className="container admin-page">
      <div className="admin-breadcrumbs">
        <Link href="/admin">Админка</Link>
        <span>/</span>
        <span>Выплаты переводчикам</span>
      </div>

      <header className="admin-head">
        <div>
          <h1>Выплаты переводчикам</h1>
          <p className="admin-head-sub">
            Сколько ты должна каждому переводчику за{' '}
            <strong>{range.label}</strong>. Монеты считаются по реальным покупкам
            глав; 1 монета = 1 ₽ на момент выплаты (курс настраивается в
            закрытии цикла).
          </p>
        </div>
      </header>

      {/* Селектор месяца */}
      <nav className="bookmark-tabs" style={{ marginBottom: 20 }}>
        {months.map((m) => (
          <Link
            key={m.key}
            href={`/admin/all-payouts?period=${m.key}`}
            className={`bookmark-tab${currentKey === m.key ? ' active' : ''}`}
          >
            {m.label}
          </Link>
        ))}
      </nav>

      {/* Суммарные цифры + CSV-экспорт (киллер #1) */}
      <AllPayoutsClient
        periodLabel={range.label}
        periodFrom={range.from}
        periodTo={range.to}
        rows={rows}
        paidMap={Object.fromEntries(paidMap)}
        totalCoins={totalCoins}
      />
    </main>
  );
}
