'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

// Раздел «Связанные аккаунты» в настройках профиля.
// Показывает, какими способами пользователь может войти в свой аккаунт:
// email+пароль, Google OAuth, Telegram (через tene-аккаунт).
// Позволяет привязать дополнительный способ к существующему аккаунту.
//
// ВАЖНО: в Supabase self-hosted для linkIdentity() должно быть разрешено
// «Manual Linking» (Auth → Providers → Enable Account Linking). Если не
// включено — linkIdentity() вернёт ошибку manual_linking_disabled, UI
// покажет её в тосте.
//
// Telegram — пока read-only (текущий @chaptifybot flow создаёт новый
// аккаунт, не умеет привязывать к существующему). Доработка бота —
// отдельный шаг.

interface Identity {
  id: string;
  identity_id: string;
  user_id: string;
  provider: string;
  identity_data?: { email?: string; name?: string } | null;
  created_at?: string;
}

const PROVIDERS = [
  { id: 'google',   label: 'Google',   icon: 'G' },
  // { id: 'yandex',   label: 'Яндекс',   icon: 'Я' }, // когда добавим провайдера в Supabase
];

export default function LinkedAccounts({ telegramId }: { telegramId: number | null }) {
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);

  const reload = async () => {
    setLoading(true);
    const supabase = createClient();
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
  }, []);

  const handleLink = async (provider: string) => {
    setBusy(provider);
    setMsg(null);
    const supabase = createClient();

    // Явно запрашиваем URL + skipBrowserRedirect:true, чтобы:
    //  1) Увидеть любую ошибку (manual_linking_disabled, session, etc.)
    //     в data/error, а не в виде молчаливого редиректа.
    //  2) Самим делать window.location.href = data.url —
    //     без surprises от supabase-js версии.
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
          `проверь переменную GOTRUE_SECURITY_MANUAL_LINKING_ENABLED=true ` +
          `и перезапусти сервис auth.`,
        tone: 'err',
      });
      // eslint-disable-next-line no-console
      console.error('[link-identity] failed', { error, data });
      return;
    }
    // Уходим на Google. При возврате /auth/callback обменяет код,
    // identity добавится в профиль, редирект на /profile/settings.
    window.location.href = data.url;
  };

  const handleUnlink = async (identity: Identity) => {
    if (identities.length < 2) {
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
    // unlinkIdentity принимает весь объект identity
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

  const hasProvider = (p: string) => identities.some((i) => i.provider === p);
  const emailIdentity = identities.find((i) => i.provider === 'email');

  return (
    <section className="settings-block">
      <h2>Связанные аккаунты</h2>
      <p className="form-hint" style={{ marginTop: 0, marginBottom: 12 }}>
        К одному профилю можно привязать несколько способов входа, чтобы не
        потерять аккаунт, если один из них недоступен.
      </p>

      {loading ? (
        <p style={{ color: 'var(--ink-mute)', fontSize: 13 }}>Загружаем…</p>
      ) : (
        <div className="linked-accounts-list">
          {/* Email — отдельным блоком, всегда read-only */}
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

          {/* OAuth-провайдеры */}
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

          {/* Telegram */}
          <div className="linked-account-row">
            <div className="linked-account-icon" aria-hidden="true">✈</div>
            <div className="linked-account-body">
              <div className="linked-account-title">Telegram</div>
              <div className="linked-account-sub">
                {telegramId
                  ? `Привязан (id: ${telegramId})`
                  : 'Через @chaptifybot (пока только для новых аккаунтов)'}
              </div>
            </div>
            <span className="linked-account-status">
              {telegramId ? 'Привязан' : 'Скоро'}
            </span>
          </div>
        </div>
      )}

      {msg && (
        <div
          style={{
            marginTop: 12,
            padding: '8px 12px',
            borderRadius: 6,
            background: msg.tone === 'ok' ? '#e5f5ea' : '#fbeae8',
            color: msg.tone === 'ok' ? '#2a7a44' : '#a5342b',
            fontSize: 13,
          }}
        >
          {msg.text}
        </div>
      )}
    </section>
  );
}
