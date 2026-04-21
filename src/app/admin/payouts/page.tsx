import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import PayoutsClient from './PayoutsClient';

export const metadata = { title: 'Выплаты — Chaptify' };

export default async function PayoutsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  const p = profile as {
    role?: string;
    is_admin?: boolean;
    user_name?: string | null;
    payout_tribute_webhook_token?: string | null;
    payout_tribute_secret?: string | null;
    payout_last_tribute_event_at?: string | null;
    payout_boosty_url?: string | null;
    payout_last_boosty_sync_at?: string | null;
  } | null;

  const isTranslator =
    p?.is_admin === true || p?.role === 'translator' || p?.role === 'admin';
  if (!isTranslator) redirect('/admin');

  return (
    <main className="container admin-page">
      <div className="admin-breadcrumbs">
        <Link href="/admin">Админка</Link>
        <span>/</span>
        <span>Выплаты</span>
      </div>

      <header className="admin-head" style={{ marginBottom: 24 }}>
        <div>
          <h1>Способы выплат</h1>
          <p className="admin-head-sub">
            Настрой, куда приходят деньги от подписчиков и донатов.
          </p>
        </div>
      </header>

      <PayoutsClient
        initial={{
          tributeWebhookToken: p?.payout_tribute_webhook_token ?? null,
          tributeLastEventAt: p?.payout_last_tribute_event_at ?? null,
          boostyUrl: p?.payout_boosty_url ?? '',
          boostyLastSyncAt: p?.payout_last_boosty_sync_at ?? null,
        }}
      />
    </main>
  );
}
