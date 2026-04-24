'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import TelegramLoginWidget from '@/components/auth/TelegramLoginWidget';

const TG_BOT_USERNAME = process.env.NEXT_PUBLIC_TG_BOT_USERNAME || 'chaptifybot';
const AUTH_API_URL    = process.env.NEXT_PUBLIC_AUTH_API_URL || '';

// Раздел «Связанные аккаунты» в настройках профиля.
// Поддерживает:
//   - email (read-only, только отображение)
//   - Google через supabase.auth.linkIdentity (требует Manual Linking в GoTrue)
//   - Telegram через наш auth-service-chaptify /auth/link-telegram

interface Identity {
  id: string;
  identity_id: string;
  user_id: string;
  provider: string;
  identity_data?: { email?: string; name?: string } | null;
  created_at?: string;
}

const PROVIDERS = [
  { id: 'google', label: 'Google', icon: 'G' },
];

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

interface Props {
  telegramId: number | null;
  hasChaptifyBot: boolean;   // есть ли chaptify_bot_chat_id
}

export default function LinkedAccounts({ telegramId, hasChaptifyBot }: Props) {
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);
  const [showTgWidget, setShowTgWidget] = useState(false);
  const [localTelegramId, setLocalTelegramId] = useState<number | null>(telegramId);

  const reload = async () => {
    setLoading(true);
    const supabase = createClient();

    try {
      await supabase.auth.refreshSession();
    } catch {
      /* noop */
    }

    const { data, error } = await supabase.auth.getUserIdentities();
    if (error) {
      setMsg({ text: `Не удалось загрузить: ${error.message}`, tone: 'err' });
      setLoading(false);
      return;
    }
    setIdentities((data?.identities ?? []) as Identity[]);
    setLoading(false);
  };

  useEffect(() => {
    reload();
    const t = setTimeout(reload, 600);
    return () => clearTimeout(t);
  }, []);

  const handleLink = async (provider: string) => {
    setBusy(provider);
    setMsg(null);
    const supabase = createClient();

    let data: { url?: string } | null = null;
    let error: { message?: string } | null = null;
    try {
      const res = await supabase.auth.linkIdentity({
        provider: provider as 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/profile/settings`,
          skipBrowserRedirect: true,
        },
      });
      data = (res as { data?: { url?: string } }).data ?? null;
      error = (res as { error?: { message?: string } }).error ?? null;
    } catch (e) {
      error = { message: e instanceof Error ? e.message : 'unknown error' };
    }

    if (error || !data?.url) {
      setBusy(null);
      const reason = error?.message ?? 'сервер не вернул URL для OAuth';
      setMsg({
        text:
          `Не получилось привязать Google: ${reason}. ` +
          `Скорее всего на Supabase (GoTrue) не включён Manual Linking — ` +
          `проверь переменную GOTRUE_SECURITY_MANUAL_LINKING_ENABLED=true.`,
        tone: 'err',
      });
      console.error('[link-identity] failed', { error, data });
      return;
    }
    window.location.href = data.url;
  };

  const handleUnlink = async (identity: Identity) => {
    if (identities.length < 2 && !localTelegramId) {
      setMsg({
        text: 'Нельзя отвязать последний способ входа — останешься без доступа к аккаунту.',
        tone: 'err',
      });
      return;
    }
    if (!confirm(`Отвязать ${identity.provider}?`)) return;
    setBusy(identity.provider);
    setMsg(null);
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.auth.unlinkIdentity(identity as any);
    setBusy(null);
    if (error) {
      setMsg({ text: `Не получилось: ${error.message}`, tone: 'err' });
      return;
    }
    setMsg({ text: '✓ Отвязано', tone: 'ok' });
    reload();
  };

  // --- Telegram flow ---
  const handleTgAuth = async (user: TelegramUser) => {
    setBusy('telegram');
    setMsg(null);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setBusy(null);
      setMsg({ text: 'Сессия потеряна — перезайди.', tone: 'err' });
      return;
    }
    try {
      const resp = await fetch(`${AUTH_API_URL}/auth/link-telegram`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ widgetData: user }),
      });
      const data = (await resp.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        telegram_id?: number;
      };
      setBusy(null);
      if (!resp.ok || !data.ok) {
        setMsg({
          text:
            data.message ??
            `Не получилось привязать Telegram: ${data.error ?? resp.statusText}`,
          tone: 'err',
        });
        return;
      }
      setLocalTelegramId(data.telegram_id ?? user.id);
      setShowTgWidget(false);
      setMsg({ text: '✓ Telegram привязан', tone: 'ok' });
    } catch (e) {
      setBusy(null);
      setMsg({
        text: `Не получилось: ${e instanceof Error ? e.message : 'сеть'}`,
        tone: 'err',
      });
    }
  };

  const handleTgUnlink = async () => {
    if (!confirm('Отвязать Telegram? Уведомления в бот тоже выключатся.')) return;
    setBusy('telegram');
    setMsg(null);
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setBusy(null);
      return;
    }
    try {
      const resp = await fetch(`${AUTH_API_URL}/auth/unlink-telegram`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = (await resp.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      setBusy(null);
      if (!resp.ok || !data.ok) {
        setMsg({
          text: data.message ?? `Не получилось: ${data.error ?? resp.statusText}`,
          tone: 'err',
        });
        return;
      }
      setLocalTelegramId(null);
      setMsg({ text: '✓ Telegram отвязан', tone: 'ok' });
    } catch (e) {
      setBusy(null);
      setMsg({
        text: `Не получилось: ${e instanceof Error ? e.message : 'сеть'}`,
        tone: 'err',
      });
    }
  };

  const hasProvider = (p: string) => identities.some((i) => i.provider === p);
  const emailIdentity = identities.find((i) => i.provider === 'email');

  const showBotBanner = !!localTelegramId && !hasChaptifyBot;

  return (
    <section className="settings-block">
      <h2>
        Связанные аккаунты
        <button
          type="button"
          className="btn btn-ghost"
          onClick={reload}
          style={{ marginLeft: 12, height: 24, fontSize: 12 }}
          title="Перечитать список"
        >
          ⟳
        </button>
      </h2>
      <p className="form-hint" style={{ marginTop: 0, marginBottom: 12 }}>
        К одному профилю можно привязать несколько способов входа, чтобы не
        потерять аккаунт, если один из них недоступен.
      </p>

      {loading ? (
        <p style={{ color: 'var(--ink-mute)', fontSize: 13 }}>Загружаем…</p>
      ) : (
        <div className="linked-accounts-list">
          {/* Email — read-only */}
          {emailIdentity && (
            <div className="linked-account-row">
              <div className="linked-account-icon" aria-hidden="true">✉</div>
              <div className="linked-account-body">
                <div className="linked-account-title">Email и пароль</div>
                <div className="linked-account-sub">
                  {emailIdentity.identity_data?.email ?? 'Привязан'}
                </div>
              </div>
              <span className="linked-account-status">Привязан</span>
            </div>
          )}

          {/* OAuth */}
          {PROVIDERS.map((p) => {
            const linked = hasProvider(p.id);
            const identity = identities.find((i) => i.provider === p.id);
            return (
              <div key={p.id} className="linked-account-row">
                <div className="linked-account-icon" aria-hidden="true">{p.icon}</div>
                <div className="linked-account-body">
                  <div className="linked-account-title">{p.label}</div>
                  <div className="linked-account-sub">
                    {linked
                      ? identity?.identity_data?.email ?? 'Привязан'
                      : 'Не привязан'}
                  </div>
                </div>
                {linked ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => handleUnlink(identity!)}
                    disabled={busy === p.id}
                  >
                    {busy === p.id ? '…' : 'Отвязать'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleLink(p.id)}
                    disabled={busy === p.id}
                  >
                    {busy === p.id ? '…' : 'Привязать'}
                  </button>
                )}
              </div>
            );
          })}

          {/* Telegram — работает через auth-service-chaptify */}
          <div className="linked-account-row">
            <div className="linked-account-icon" aria-hidden="true">✈</div>
            <div className="linked-account-body">
              <div className="linked-account-title">Telegram</div>
              <div className="linked-account-sub">
                {localTelegramId
                  ? `Привязан (id: ${localTelegramId})`
                  : 'Не привязан'}
              </div>
            </div>
            {localTelegramId ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleTgUnlink}
                disabled={busy === 'telegram'}
              >
                {busy === 'telegram' ? '…' : 'Отвязать'}
              </button>
            ) : showTgWidget ? (
              <div style={{ flexShrink: 0 }}>
                <TelegramLoginWidget botName={TG_BOT_USERNAME} onAuth={handleTgAuth} />
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowTgWidget(true)}
                disabled={busy === 'telegram'}
              >
                Привязать
              </button>
            )}
          </div>
        </div>
      )}

      {/* Плашка «подпишись на уведомления» если TG привязан, но bot_chat_id пуст */}
      {showBotBanner && (
        <div className="bot-notify-banner">
          <div className="bot-notify-banner-icon" aria-hidden="true">🔔</div>
          <div className="bot-notify-banner-body">
            <div className="bot-notify-banner-title">
              Получай уведомления в Telegram
            </div>
            <div className="bot-notify-banner-sub">
              Telegram привязан. Осталось открыть бот и написать <code>/start</code> —
              и я буду присылать важные события (чаевые, отклики на маркетплейсе,
              новые подписчики, друзья).
            </div>
          </div>
          <a
            href={`https://t.me/${TG_BOT_USERNAME}?start=notify`}
            target="_blank"
            rel="noreferrer noopener"
            className="btn btn-primary"
          >
            Открыть @{TG_BOT_USERNAME}
          </a>
        </div>
      )}

      {msg && (
        <div
          style={{
            marginTop: 12,
            padding: '8px 12px',
            borderRadius: 6,
            // CSS-переменные статуса (см. globals.css) — в тёмной теме
            // автоматически переключаются на приглушённые тона.
            background:
              msg.tone === 'ok' ? 'var(--status-ok-bg)' : 'var(--status-err-bg)',
            color:
              msg.tone === 'ok' ? 'var(--status-ok-ink)' : 'var(--status-err-ink)',
            fontSize: 13,
          }}
        >
          {msg.text}
        </div>
      )}
    </section>
  );
}
