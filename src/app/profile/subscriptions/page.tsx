import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';

export const metadata = {
  title: 'Мои подписки — Chaptify',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

export default async function SubscriptionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Грузим подписки + переводчиков
  let subs: Array<{
    id: number;
    translator_id: string;
    provider: string;
    plan: string;
    status: string;
    started_at: string | null;
    expires_at: string | null;
    translator: {
      id: string;
      user_name: string | null;
      translator_slug: string | null;
      translator_display_name: string | null;
      translator_avatar_url: string | null;
    } | null;
  }> = [];

  try {
    const { data: subsData } = await supabase
      .from('chaptify_subscriptions')
      .select('id, translator_id, provider, plan, status, started_at, expires_at')
      .eq('user_id', user.id)
      .order('started_at', { ascending: false });

    const raw = subsData ?? [];
    if (raw.length > 0) {
      const translatorIds = Array.from(new Set(raw.map((s) => s.translator_id)));
      // public_profiles (мигр. 040) — RLS на profiles прямой запрос для
      // чужих переводчиков не отдаёт.
      const { data: translators } = await supabase
        .from('public_profiles')
        .select('id, user_name, translator_slug, translator_display_name, translator_avatar_url')
        .in('id', translatorIds);
      const tMap = new Map((translators ?? []).map((t) => [t.id, t]));
      subs = raw.map((s) => ({
        ...s,
        translator: tMap.get(s.translator_id) ?? null,
      }));
    }
  } catch {
    // Таблица subscriptions ещё не создана (миграция 001 не накачена)
  }

  const active  = subs.filter((s) => s.status === 'active');
  const pending = subs.filter((s) => s.status === 'pending');
  const expired = subs.filter((s) => s.status === 'expired' || s.status === 'cancelled');

  return (
    <main className="container section">
      <div className="admin-breadcrumbs">
        <Link href="/profile">Профиль</Link>
        <span>/</span>
        <span>Мои подписки</span>
      </div>

      <header className="admin-head" style={{ marginBottom: 24 }}>
        <div>
          <h1>Мои подписки</h1>
          <p className="admin-head-sub">
            Подписки открывают все платные главы переводчика на срок подписки.
          </p>
        </div>
        <Link href="/catalog" className="btn btn-ghost">
          К переводчикам
        </Link>
      </header>

      {subs.length === 0 && (
        <div className="empty-state">
          <p>
            Пока ни одной подписки. Зайди на страницу переводчика и оформи —
            откроются все его платные главы сразу.
          </p>
          <Link href="/catalog" className="btn btn-primary">
            К каталогу
          </Link>
        </div>
      )}

      {active.length > 0 && (
        <section className="subs-section">
          <h2>Активные</h2>
          <div className="subs-list">
            {active.map((s) => {
              const left = daysLeft(s.expires_at);
              const slug = s.translator?.translator_slug || s.translator?.user_name;
              return (
                <div key={s.id} className="subs-row subs-row--active">
                  <div className="subs-avatar">
                    {s.translator?.translator_avatar_url ? (
                      <img src={s.translator.translator_avatar_url} alt="" />
                    ) : (
                      <span>
                        {(s.translator?.translator_display_name || s.translator?.user_name || '?').charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="subs-body">
                    <div className="subs-translator">
                      {slug ? (
                        <Link href={`/t/${slug}`}>
                          {s.translator?.translator_display_name || s.translator?.user_name}
                        </Link>
                      ) : (
                        <span>{s.translator?.translator_display_name || s.translator?.user_name || 'Переводчик'}</span>
                      )}
                      <span className="subs-provider">{providerLabel(s.provider)}</span>
                    </div>
                    <div className="subs-plan">
                      {planLabel(s.plan)} · действует до {formatDate(s.expires_at)}
                      {left !== null && left > 0 && left <= 7 && (
                        <span className="subs-warning"> · осталось {left} {plural(left, 'день', 'дня', 'дней')}</span>
                      )}
                    </div>
                  </div>
                  <span className="status-pill status-active">Активна</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {pending.length > 0 && (
        <section className="subs-section">
          <h2>Ожидают подтверждения</h2>
          <div className="subs-list">
            {pending.map((s) => (
              <div key={s.id} className="subs-row">
                <div className="subs-avatar">⏳</div>
                <div className="subs-body">
                  <div className="subs-translator">
                    {s.translator?.translator_display_name || s.translator?.user_name || 'Переводчик'}
                    <span className="subs-provider">{providerLabel(s.provider)}</span>
                  </div>
                  <div className="subs-plan">
                    {planLabel(s.plan)} · ждём вебхук от платёжной системы
                  </div>
                </div>
                <span className="status-pill">В ожидании</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {expired.length > 0 && (
        <section className="subs-section">
          <h2>История</h2>
          <div className="subs-list">
            {expired.slice(0, 10).map((s) => {
              const slug = s.translator?.translator_slug || s.translator?.user_name;
              return (
                <div key={s.id} className="subs-row subs-row--dim">
                  <div className="subs-avatar" style={{ opacity: 0.6 }}>
                    {(s.translator?.translator_display_name || s.translator?.user_name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="subs-body">
                    <div className="subs-translator">
                      {slug ? (
                        <Link href={`/t/${slug}`}>
                          {s.translator?.translator_display_name || s.translator?.user_name}
                        </Link>
                      ) : (
                        <span>{s.translator?.translator_display_name || s.translator?.user_name}</span>
                      )}
                      <span className="subs-provider">{providerLabel(s.provider)}</span>
                    </div>
                    <div className="subs-plan">
                      {planLabel(s.plan)} · закончилась {formatDate(s.expires_at)}
                    </div>
                  </div>
                  <span className="status-pill status-expired">
                    {s.status === 'cancelled' ? 'Отменена' : 'Истекла'}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}

function providerLabel(provider: string): string {
  switch (provider) {
    case 'tribute':  return 'Tribute';
    case 'boosty':   return 'Boosty';
    case 'vk_donut': return 'VK Donut';
    case 'patreon':  return 'Patreon';
    case 'card':     return 'Карта';
    case 'other':    return 'Другое';
    default:         return provider;
  }
}

function planLabel(plan: string): string {
  switch (plan) {
    case 'monthly_basic':  return 'Месячная';
    case 'monthly_pro':    return 'Месячная Pro';
    case 'yearly':         return 'Годовая';
    case 'external_claim': return 'Внешняя подписка';
    default:               return plan;
  }
}

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
