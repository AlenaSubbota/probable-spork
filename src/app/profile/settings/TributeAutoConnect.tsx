'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useToasts, ToastStack } from '@/components/ui/Toast';

const AUTH_API_URL = process.env.NEXT_PUBLIC_AUTH_API_URL || '';

interface Status {
  connected: boolean;
  webhook_token?: string | null;
  last_event_at?: string | null;
  last_event_name?: string | null;
  last_error?: string | null;
  events_count?: number;
}

// Секция «🔑 Автосинк через Tribute API».
//
// Тут у Tribute есть важное отличие от Boosty: Tribute сам шлёт нам
// webhook'и на события (new_subscription, new_donation и т.п.). Нам не
// надо ходить к ним за данными — достаточно дать им наш URL и сохранить
// их API-Key для проверки HMAC-подписи.
//
// Флоу:
//   1. Переводчик на Tribute Dashboard → Settings → API Keys → Generate.
//   2. Копирует ключ, вставляет здесь → жмём «Подключить».
//   3. Мы валидируем ключ тестовым запросом и сохраняем зашифрованным.
//   4. Показываем ему webhook URL, который он вставляет в Tribute
//      Dashboard → Settings → Webhooks.
//   5. Дальше подписки и донаты прилетают сами.
export default function TributeAutoConnect() {
  const supabase = createClient();
  const { items: toasts, push, dismiss } = useToasts();

  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_my_tribute_connection_status');
    setLoading(false);
    if (error) {
      push('error', `Статус не загрузился: ${error.message}`);
      return;
    }
    const res = (data ?? {}) as { ok?: boolean } & Status;
    if (!res.ok) {
      push('error', 'Не авторизован.');
      return;
    }
    setStatus({
      connected:        !!res.connected,
      webhook_token:    res.webhook_token ?? null,
      last_event_at:    res.last_event_at ?? null,
      last_event_name:  res.last_event_name ?? null,
      last_error:       res.last_error ?? null,
      events_count:     res.events_count ?? 0,
    });
    // Webhook URL формируется из токена — показываем даже если не connected,
    // чтобы переводчик мог заранее подставить его в Tribute.
    if (res.webhook_token) {
      const base = AUTH_API_URL || 'https://chaptify.ru';
      setWebhookUrl(`${base}/tribute/${res.webhook_token}`);
    }
  };

  useEffect(() => {
    reload();
    const onFocus = () => reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    if (!AUTH_API_URL) {
      push('error', 'NEXT_PUBLIC_AUTH_API_URL не задан — скажи админу.');
      return;
    }
    if (apiKey.trim().length < 10) {
      push('error', 'Api-Key короткий — скопируй полностью из Tribute Dashboard.');
      return;
    }
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        push('error', 'Сессия потерялась — перезайди.');
        setBusy(false);
        return;
      }
      const resp = await fetch(`${AUTH_API_URL}/auth/tribute-connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ api_key: apiKey.trim() }),
      });
      const body = (await resp.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        webhook_url?: string;
      };
      setBusy(false);
      if (!resp.ok || !body.ok) {
        const human: Record<string, string> = {
          invalid_api_key: 'Tribute сказал, что ключ не подходит. Проверь, что скопировал его полностью, и что он не отозван.',
          api_key_too_short: 'Ключ слишком короткий — не похоже на настоящий.',
          tribute_unreachable: 'Tribute сейчас не отвечает — попробуй через минуту.',
          service_not_configured: 'Фича выключена на сервере. Напиши админу.',
        };
        push('error', human[body.error ?? ''] ?? `Ошибка: ${body.message ?? body.error ?? resp.statusText}`);
        return;
      }
      setApiKey('');
      setShowKeyInput(false);
      if (body.webhook_url) setWebhookUrl(body.webhook_url);
      push('success', '✓ Ключ принят. Осталось вставить webhook-URL в Tribute — см. инструкцию ниже.');
      reload();
    } catch (e) {
      setBusy(false);
      push('error', `Сеть: ${e instanceof Error ? e.message : 'ошибка'}`);
    }
  };

  const disconnect = async () => {
    if (!confirm('Отвязать Tribute? Webhook-события перестанут приниматься.')) return;
    const { error } = await supabase.rpc('disconnect_my_tribute');
    if (error) {
      push('error', error.message);
      return;
    }
    push('success', 'Отвязано.');
    reload();
  };

  const copyWebhookUrl = async () => {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      push('success', 'Скопировано — вставляй в Tribute Dashboard.');
    } catch {
      push('info', 'Скопируй вручную: ' + webhookUrl);
    }
  };

  if (loading) {
    return (
      <div className="payment-method-autosync" style={{ color: 'var(--ink-mute)', fontSize: 13 }}>
        Загружаем статус Tribute…
      </div>
    );
  }

  return (
    <div className="payment-method-autosync">
      <div
        style={{
          fontWeight: 600,
          fontSize: 13,
          marginBottom: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        🔑 Автосинк через Tribute API
        {status?.connected && (
          <span
            style={{
              fontSize: 11,
              color: 'var(--status-ok-ink)',
              background: 'var(--status-ok-bg)',
              borderRadius: 4,
              padding: '1px 6px',
            }}
          >
            подключено
          </span>
        )}
      </div>

      {status?.connected ? (
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
          Событий обработано: <strong>{status.events_count ?? 0}</strong>
          {status.last_event_at && (
            <>
              <br />
              Последнее: <code>{status.last_event_name}</code> —{' '}
              {new Date(status.last_event_at).toLocaleString()}
            </>
          )}
          {status.last_error && (
            <div style={{ color: 'var(--status-err-ink)', fontSize: 12, marginTop: 4 }}>
              ⚠ Ошибка: {status.last_error}
            </div>
          )}
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setShowKeyInput(true)}
              style={{ height: 28, fontSize: 12 }}
            >
              ↻ Обновить ключ
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={disconnect}
              style={{ height: 28, fontSize: 12, color: 'var(--status-err-ink)' }}
            >
              Отвязать
            </button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
          Подписки и донаты читателей через Tribute будут подтверждаться
          автоматически — по webhook'у от Tribute. <strong>Монеты</strong>
          {' '}зачисляются сразу, если в сообщении доната указан код{' '}
          <code>M-XXXXXXXX</code> и сумма совпадает.
          {!showKeyInput && (
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowKeyInput(true)}
                style={{ height: 32, fontSize: 13 }}
              >
                🔑 Подключить Tribute
              </button>
            </div>
          )}
        </div>
      )}

      {showKeyInput && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            background: 'var(--status-warn-bg)',
            border: '1px solid var(--status-warn-border)',
            color: 'var(--status-warn-ink)',
            borderRadius: 6,
            fontSize: 13,
            lineHeight: 1.55,
          }}
        >
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              В Tribute: Dashboard → три точки (⋯) → <b>API Keys</b> →{' '}
              <b>Generate API Key</b>. Скопируй показанный ключ (он отдаётся
              один раз).
            </li>
            <li style={{ marginTop: 6 }}>
              Вставь сюда:
              <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Api-Key из Tribute Dashboard"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="off"
                  style={{ flex: 1, minWidth: 220, fontSize: 13 }}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={connect}
                  disabled={busy || apiKey.trim().length < 10}
                  style={{ height: 32, fontSize: 13 }}
                >
                  {busy ? 'Проверяю…' : 'Подключить'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => { setShowKeyInput(false); setApiKey(''); }}
                  style={{ height: 32, fontSize: 13 }}
                >
                  Отмена
                </button>
              </div>
            </li>
          </ol>
          <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 8 }}>
            Ключ шифруется AES-256-GCM и хранится у нас. В открытом виде
            не светится нигде. Отвязка стирает его полностью.
          </div>
        </div>
      )}

      {webhookUrl && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            background: 'var(--status-info-bg)',
            border: '1px solid var(--status-info-border)',
            color: 'var(--status-info-ink)',
            borderRadius: 6,
            fontSize: 13,
            lineHeight: 1.55,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            📎 Webhook URL для Tribute
          </div>
          <div style={{ color: 'var(--ink-mute)', marginBottom: 6 }}>
            Скопируй этот адрес и вставь в Tribute: Dashboard → ⋯ → API Keys →
            раздел <b>Webhook URL</b>.
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <code
              style={{
                background: 'var(--surface)',
                color: 'var(--ink)',
                padding: '6px 10px',
                borderRadius: 4,
                border: '1px solid var(--border)',
                fontSize: 12,
                wordBreak: 'break-all',
                flex: 1,
                minWidth: 200,
              }}
            >
              {webhookUrl}
            </code>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={copyWebhookUrl}
              style={{ height: 30, fontSize: 12 }}
            >
              📋 Скопировать
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 8 }}>
            URL уникальный — никому его не показывай. Подпись webhook'а
            мы проверяем твоим же API-Key, но лишняя осторожность не помешает.
          </div>
        </div>
      )}

      <ToastStack items={toasts} onDismiss={dismiss} />
    </div>
  );
}
