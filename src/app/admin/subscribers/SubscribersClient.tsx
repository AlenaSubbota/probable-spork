'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { timeAgo } from '@/lib/format';
import { useToasts, ToastStack } from '@/components/ui/Toast';

interface Claim {
  id: number;
  user_id: string;
  translator_id: string;
  provider: string;
  code: string;
  external_username: string | null;
  note: string | null;
  status: 'pending' | 'approved' | 'declined';
  decline_reason: string | null;
  tier_months: number;
  /** 'subscription' | 'coins' — добавлено в мигр. 045. Старые ряды = subscription. */
  kind?: 'subscription' | 'coins' | null;
  coins_amount?: number | null;
  created_at: string;
  reviewed_at: string | null;
  user_name: string | null;
  user_avatar: string | null;
}

interface ActiveSub {
  id: number;
  user_id: string;
  user_name: string | null;
  user_avatar: string | null;
  user_slug: string | null;
  provider: string;
  plan: string;
  expires_at: string | null;
  started_at: string | null;
}

interface Props {
  pending: Claim[];
  reviewed: Claim[];
  active: ActiveSub[];
}

const PROVIDER_LABEL: Record<string, string> = {
  boosty:   'Boosty',
  tribute:  'Tribute',
  vk_donut: 'VK Donut',
  patreon:  'Patreon',
  other:    'Другое',
};

function formatExpires(iso: string | null): string {
  if (!iso) return '— бессрочно';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = Date.now();
  const diffDays = Math.floor((d.getTime() - now) / (86_400_000));
  const dateStr = d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  if (diffDays < 0) return `истекло ${timeAgo(iso)}`;
  if (diffDays === 0) return 'истекает сегодня';
  if (diffDays < 7) return `осталось ${diffDays} дн.`;
  return `до ${dateStr}`;
}

export default function SubscribersClient({ pending, reviewed, active }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const { items: toasts, push, dismiss } = useToasts();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [declineFor, setDeclineFor] = useState<number | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [providerFilter, setProviderFilter] = useState<string>('all');

  // Список уникальных провайдеров среди активных — для табов-фильтра.
  // Ленту заявок не фильтруем: они обычно все одного провайдера + их мало.
  const activeByProvider = new Map<string, number>();
  for (const s of active) {
    activeByProvider.set(s.provider, (activeByProvider.get(s.provider) ?? 0) + 1);
  }
  const filteredActive =
    providerFilter === 'all'
      ? active
      : active.filter((s) => s.provider === providerFilter);

  const approve = async (id: number) => {
    setBusyId(id);
    const { data, error } = await supabase.rpc('approve_subscription_claim', {
      p_claim_id: id,
    });
    setBusyId(null);
    if (error) {
      push('error', error.message);
      return;
    }
    const res = (data ?? {}) as { ok?: boolean; error?: string };
    if (!res.ok) {
      push('error', res.error ?? 'unknown');
      return;
    }
    push('success', 'Одобрено — читатель получил доступ.');
    router.refresh();
  };

  const revoke = async (id: number) => {
    const reason = prompt(
      'Причина отзыва (по желанию — подписчик увидит её в уведомлении):',
      ''
    );
    if (reason === null) return;
    setBusyId(id);
    const { data, error } = await supabase.rpc('revoke_subscription', {
      p_subscription_id: id,
      p_reason: reason.trim() || null,
    });
    setBusyId(null);
    if (error) {
      push('error', error.message);
      return;
    }
    const res = (data ?? {}) as { ok?: boolean; error?: string };
    if (!res.ok) {
      push('error', res.error ?? 'unknown');
      return;
    }
    push('success', 'Подписка отозвана.');
    router.refresh();
  };

  const decline = async (id: number) => {
    setBusyId(id);
    const { data, error } = await supabase.rpc('decline_subscription_claim', {
      p_claim_id: id,
      p_reason: declineReason.trim() || null,
    });
    setBusyId(null);
    if (error) {
      push('error', error.message);
      return;
    }
    const res = (data ?? {}) as { ok?: boolean; error?: string };
    if (!res.ok) {
      push('error', res.error ?? 'unknown');
      return;
    }
    push('success', 'Отклонено.');
    setDeclineFor(null);
    setDeclineReason('');
    router.refresh();
  };

  return (
    <>
      {/* Pending */}
      <section className="market-section">
        <h2>
          Заявки
          {pending.length > 0 && (
            <span
              style={{
                marginLeft: 10,
                fontSize: 13,
                background: '#fdecd5',
                color: '#915e1e',
                padding: '2px 10px',
                borderRadius: 999,
              }}
            >
              {pending.length} ждут
            </span>
          )}
        </h2>

        {pending.length === 0 ? (
          <div className="empty-state" style={{ padding: 18 }}>
            <p>Новых заявок нет. Когда читатель оплатит Boosty и пришлёт код — появится здесь.</p>
          </div>
        ) : (
          <div className="applications-list">
            {pending.map((c) => {
              const initial = (c.user_name ?? '?').trim().charAt(0).toUpperCase() || '?';
              const isCoinsClaim = c.kind === 'coins';
              return (
                <article key={c.id} className="application-card">
                  <header className="application-card-head">
                    <Link href={`/u/${c.user_id}`} className="application-card-author">
                      <div className="market-card-avatar">
                        {c.user_avatar ? (
                          <img src={c.user_avatar} alt="" />
                        ) : (
                          <span>{initial}</span>
                        )}
                      </div>
                      <div>
                        <div className="application-card-name">
                          {c.user_name ?? 'Читатель'}
                        </div>
                        <div className="application-card-time">
                          {timeAgo(c.created_at)} · {PROVIDER_LABEL[c.provider] ?? c.provider}
                          {isCoinsClaim
                            ? ` · покупка ${c.coins_amount ?? 0} монет`
                            : ` · подписка на ${c.tier_months} мес.`}
                        </div>
                      </div>
                    </Link>
                    <span
                      className={`claim-kind-badge claim-kind-badge--${isCoinsClaim ? 'coins' : 'subscription'}`}
                    >
                      {isCoinsClaim ? '💰 монеты' : '📅 подписка'}
                    </span>
                  </header>

                  <div className="claim-details">
                    <div className="claim-details-row">
                      <span className="claim-details-label">Ник на {PROVIDER_LABEL[c.provider]}:</span>
                      <strong>{c.external_username ?? '— не указано —'}</strong>
                    </div>
                    <div className="claim-details-row">
                      <span className="claim-details-label">Код:</span>
                      <code className="claim-code-badge">{c.code}</code>
                    </div>
                    {c.note && (
                      <div className="claim-details-row">
                        <span className="claim-details-label">Комментарий:</span>
                        <span>{c.note}</span>
                      </div>
                    )}
                    <div className="claim-hint">
                      {isCoinsClaim
                        ? `Проверь: пришёл ли этот читатель в твой ${PROVIDER_LABEL[c.provider] ?? c.provider} с кодом и правильной суммой (${c.coins_amount ?? 0} монет). Одобрение зачислит монеты на его per-translator кошелёк — тратить их он сможет только на твои новеллы.`
                        : 'Сверь ник со своим списком подписчиков на Boosty и код в своих сообщениях/комментах, прежде чем одобрить.'}
                    </div>
                  </div>

                  {declineFor === c.id ? (
                    <div className="claim-decline-form">
                      <textarea
                        className="form-textarea"
                        rows={2}
                        maxLength={300}
                        placeholder="Причина отклонения (необязательно, но читателю будет видно)"
                        value={declineReason}
                        onChange={(e) => setDeclineReason(e.target.value)}
                      />
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => decline(c.id)}
                          disabled={busyId === c.id}
                        >
                          Отклонить
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => {
                            setDeclineFor(null);
                            setDeclineReason('');
                          }}
                        >
                          Отмена
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="application-card-actions">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => approve(c.id)}
                        disabled={busyId === c.id}
                      >
                        ✓ Одобрить
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setDeclineFor(c.id)}
                        disabled={busyId === c.id}
                      >
                        Отклонить
                      </button>
                      <Link
                        href={`/messages/${c.user_id}`}
                        className="btn btn-ghost"
                      >
                        💬 Написать
                      </Link>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Active subs */}
      <section className="market-section">
        <h2>Активные подписчики ({active.length})</h2>

        {active.length > 0 && activeByProvider.size > 1 && (
          <nav className="subscribers-provider-tabs" aria-label="Фильтр провайдеров">
            <button
              type="button"
              className={`subs-provider-tab${providerFilter === 'all' ? ' is-active' : ''}`}
              onClick={() => setProviderFilter('all')}
            >
              Все · {active.length}
            </button>
            {Array.from(activeByProvider.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([prov, cnt]) => (
                <button
                  key={prov}
                  type="button"
                  className={`subs-provider-tab${providerFilter === prov ? ' is-active' : ''}`}
                  onClick={() => setProviderFilter(prov)}
                >
                  {PROVIDER_LABEL[prov] ?? prov} · {cnt}
                </button>
              ))}
          </nav>
        )}

        {active.length === 0 ? (
          <div className="empty-state" style={{ padding: 18 }}>
            <p>Пока никого. После первого одобрения подписчик появится здесь.</p>
          </div>
        ) : filteredActive.length === 0 ? (
          <div className="empty-state" style={{ padding: 18 }}>
            <p>В этом провайдере сейчас никого.</p>
          </div>
        ) : (
          <div className="applications-list">
            {filteredActive.map((s) => {
              const initial = (s.user_name ?? '?').trim().charAt(0).toUpperCase() || '?';
              const href = s.user_slug ? `/t/${s.user_slug}` : `/u/${s.user_id}`;
              return (
                <article key={s.id} className="application-card">
                  <header className="application-card-head">
                    <Link href={href} className="application-card-author">
                      <div className="market-card-avatar">
                        {s.user_avatar ? (
                          <img src={s.user_avatar} alt="" />
                        ) : (
                          <span>{initial}</span>
                        )}
                      </div>
                      <div>
                        <div className="application-card-name">
                          {s.user_name ?? 'Читатель'}
                        </div>
                        <div className="application-card-time">
                          {PROVIDER_LABEL[s.provider] ?? s.provider} · {formatExpires(s.expires_at)}
                        </div>
                      </div>
                    </Link>
                  </header>
                  <div className="application-card-actions">
                    <Link
                      href={`/messages/${s.user_id}`}
                      className="btn btn-ghost"
                    >
                      💬 Написать
                    </Link>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => revoke(s.id)}
                      disabled={busyId === s.id}
                      title="Отозвать подписку: например, читатель отписался на Boosty"
                    >
                      ⊗ Отозвать
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* History */}
      {reviewed.length > 0 && (
        <section className="market-section">
          <h2>История</h2>
          <div className="applications-list">
            {reviewed.map((c) => {
              const initial = (c.user_name ?? '?').trim().charAt(0).toUpperCase() || '?';
              return (
                <article
                  key={c.id}
                  className="application-card"
                  style={{ opacity: 0.7 }}
                >
                  <header className="application-card-head">
                    <Link href={`/u/${c.user_id}`} className="application-card-author">
                      <div className="market-card-avatar">
                        {c.user_avatar ? (
                          <img src={c.user_avatar} alt="" />
                        ) : (
                          <span>{initial}</span>
                        )}
                      </div>
                      <div>
                        <div className="application-card-name">
                          {c.user_name ?? 'Читатель'}
                        </div>
                        <div className="application-card-time">
                          {c.reviewed_at ? timeAgo(c.reviewed_at) : '—'} ·{' '}
                          {c.status === 'approved' ? 'одобрено' : 'отклонено'}
                        </div>
                      </div>
                    </Link>
                    <span
                      className={
                        c.status === 'approved'
                          ? 'app-status app-status--accepted'
                          : 'app-status app-status--declined'
                      }
                    >
                      {c.status === 'approved' ? '✓' : '✗'}
                    </span>
                  </header>
                  {c.status === 'declined' && c.decline_reason && (
                    <p className="application-card-message">
                      Причина: {c.decline_reason}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      <ToastStack items={toasts} onDismiss={dismiss} />
    </>
  );
}
