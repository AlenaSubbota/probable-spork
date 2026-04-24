import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import SubscribersClient from './SubscribersClient';

export const metadata = { title: 'Подписчики — админка' };

export default async function SubscribersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_admin, payout_boosty_url')
    .eq('id', user.id)
    .maybeSingle();
  const p = profile as {
    role?: string;
    is_admin?: boolean;
    payout_boosty_url?: string | null;
  } | null;
  const isTranslator =
    p?.is_admin === true || p?.role === 'translator' || p?.role === 'admin';
  if (!isTranslator) redirect('/profile');

  // Boosty считаем настроенным, если есть либо legacy-поле, либо новая
  // запись в translator_payment_methods (мигр. 037). Раньше предупреждение
  // показывалось всегда, если переводчик добавил Boosty только через новый
  // редактор «Способы оплаты», а не через старое поле в settings.
  let hasBoostyConfigured = !!p?.payout_boosty_url;
  if (!hasBoostyConfigured) {
    const { data: methods } = await supabase
      .from('translator_payment_methods')
      .select('id')
      .eq('translator_id', user.id)
      .eq('provider', 'boosty')
      .eq('enabled', true)
      .limit(1);
    hasBoostyConfigured = (methods ?? []).length > 0;
  }

  // Pending-заявки
  const { data: pending } = await supabase
    .from('subscription_claims_view')
    .select('*')
    .eq('translator_id', user.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  // История (одобренные/отклонённые, последние 30)
  const { data: reviewed } = await supabase
    .from('subscription_claims_view')
    .select('*')
    .eq('translator_id', user.id)
    .in('status', ['approved', 'declined'])
    .order('reviewed_at', { ascending: false })
    .limit(30);

  // Активные подписчики прямо сейчас
  const { data: active } = await supabase
    .from('subscriptions')
    .select('id, user_id, provider, plan, status, expires_at, started_at')
    .eq('translator_id', user.id)
    .eq('status', 'active')
    .order('expires_at', { ascending: false });

  // Подтянем имена активных
  const activeUserIds = Array.from(
    new Set((active ?? []).map((s) => s.user_id as string)),
  );
  // public_profiles (мигр. 040): RLS на profiles разрешает читать только
  // свой ряд, поэтому имена / аватары подписчиков для рендера тянем из view.
  const { data: activeProfiles } =
    activeUserIds.length > 0
      ? await supabase
          .from('public_profiles')
          .select('id, user_name, avatar_url, translator_slug')
          .in('id', activeUserIds)
      : { data: [] as Array<{ id: string; user_name: string | null; avatar_url: string | null; translator_slug: string | null }> };
  const nameMap = new Map(
    (activeProfiles ?? []).map((r) => [r.id, r as { id: string; user_name: string | null; avatar_url: string | null; translator_slug: string | null }]),
  );

  const activeRows = (active ?? []).map((s) => {
    const pr = nameMap.get(s.user_id as string);
    return {
      id: s.id as number,
      user_id: s.user_id as string,
      user_name: pr?.user_name ?? null,
      user_avatar: pr?.avatar_url ?? null,
      user_slug: pr?.translator_slug ?? null,
      provider: (s.provider as string) ?? 'unknown',
      plan: (s.plan as string) ?? 'external_claim',
      expires_at: (s.expires_at as string | null) ?? null,
      started_at: (s.started_at as string | null) ?? null,
    };
  });

  return (
    <main className="container section" style={{ maxWidth: 1000 }}>
      <div className="admin-breadcrumbs">
        <Link href="/admin">Админка</Link>
        <span>/</span>
        <span>Подписчики</span>
      </div>

      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-serif)', margin: '0 0 6px' }}>
          Подписчики и заявки
        </h1>
        <p style={{ color: 'var(--ink-mute)', margin: 0 }}>
          Читатели оплачивают Boosty / Tribute / карту тебе напрямую, потом
          присылают заявку сюда с кодом. <strong>Подписочные</strong> заявки
          могут быть одобрены автоматически — если ты подключил{' '}
          <Link href="/profile/settings" className="more">Boosty-автосинк</Link>
          {' '}и email читателя есть у тебя в подписчиках. <strong>Монетные</strong>
          {' '}заявки всегда ждут твоего одобрения: там нужно сверить сумму
          доната. Подробнее — в{' '}
          <Link href="/help#boosty-autoconnect" className="more">справке</Link>.
        </p>
        {!hasBoostyConfigured && (
          <div
            style={{
              marginTop: 14,
              padding: '10px 14px',
              background: '#fdecd5',
              color: '#915e1e',
              borderRadius: 8,
              fontSize: 13,
            }}
          >
            У тебя не указана ссылка на Boosty. Добавь её в{' '}
            <Link href="/profile/settings" className="more">
              настройках профиля
            </Link>
            , иначе читатели не увидят вариант оплатить.
          </div>
        )}
      </header>

      <SubscribersClient
        pending={pending ?? []}
        reviewed={reviewed ?? []}
        active={activeRows}
      />
    </main>
  );
}
