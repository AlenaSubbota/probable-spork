'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { timeAgo } from '@/lib/format';

interface Props {
  initial: {
    tributeWebhookToken: string | null;
    tributeLastEventAt: string | null;
    boostyUrl: string;
    boostyLastSyncAt: string | null;
  };
}

export default function PayoutsClient({ initial }: Props) {
  const [token, setToken] = useState(initial.tributeWebhookToken);
  const [lastEventAt, setLastEventAt] = useState(initial.tributeLastEventAt);
  const [boostyUrl, setBoostyUrl] = useState(initial.boostyUrl);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const webhookUrl = token
    ? `https://tene.fun/webhook/tribute/${token}`
    : '—';

  // Киллер-фича #1: health-индикатор
  const healthLabel = (): { text: string; tone: 'green' | 'amber' | 'red' } => {
    if (!lastEventAt) return { text: 'Событий ещё не было', tone: 'amber' };
    const age = Date.now() - new Date(lastEventAt).getTime();
    const days = age / 86_400_000;
    if (days < 7) return { text: `Активен · ${timeAgo(lastEventAt)}`, tone: 'green' };
    if (days < 30) return { text: `Тихо уже ${Math.round(days)} дн.`, tone: 'amber' };
    return { text: `Похоже, отключён · ${timeAgo(lastEventAt)}`, tone: 'red' };
  };
  const health = healthLabel();

  const handleCopy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const handleRegen = async () => {
    if (!confirm(
      'Сгенерировать новый токен? Старый URL перестанет работать, ' +
      'придётся обновить его в настройках Tribute.'
    )) return;
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('regenerate_tribute_webhook_token');
    if (error) {
      setMsg('Ошибка: ' + error.message);
    } else if (data && typeof data === 'object' && 'token' in data) {
      setToken((data as { token: string }).token);
      setMsg('Новый токен сгенерирован. Не забудь обновить URL в Tribute.');
    }
    setBusy(false);
  };

  const handleBoostyUrlSave = async () => {
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    const { error } = await supabase.rpc('update_my_profile', {
      data_to_update: { payout_boosty_url: boostyUrl.trim() || null },
    });
    setBusy(false);
    if (error) {
      setMsg('Ошибка: ' + error.message);
    } else {
      setMsg('Boosty URL сохранён.');
    }
  };

  return (
    <div className="payouts-layout">
      {/* --- Tribute block --- */}
      <section className="payout-block">
        <div className="payout-block-head">
          <span className="payout-icon" aria-hidden="true">💠</span>
          <div>
            <h2>Tribute (Telegram)</h2>
            <p className="payout-block-sub">
              Честный webhook. Читатель платит в Tribute → нам приходит событие →
              мы начисляем ему монеты или активируем подписку автоматически.
            </p>
          </div>
          <span className={`payout-health payout-health--${health.tone}`}>
            <span className="payout-health-dot" /> {health.text}
          </span>
        </div>

        <div className="form-field">
          <label>Твой webhook URL</label>
          <div className="payout-url-row">
            <code className="payout-url">{webhookUrl}</code>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCopy}
              disabled={!token}
            >
              {copied ? '✓ Скопировано' : 'Скопировать'}
            </button>
          </div>
          <div className="form-hint">
            Вставь этот URL в настройках Tribute: Admin → Webhooks → Endpoint URL.
            Не делись им публично — это ключ к начислению монет в твоём кабинете.
          </div>
        </div>

        <details className="payout-details">
          <summary>Как настроить Tribute — пошагово</summary>
          <ol className="payout-steps">
            <li>Создай бота Tribute через <a href="https://t.me/tribute" target="_blank" rel="noreferrer">@tribute</a>, если ещё не создавал.</li>
            <li>В Tribute → Admin → Webhooks → добавь endpoint и вставь URL выше.</li>
            <li>Выбери события: <b>new_subscription</b>, <b>cancelled_subscription</b>, <b>donation</b>.</li>
            <li>Сохрани. При первом платеже здесь появится «Активен · N минут назад».</li>
            <li>Если читатель не приходит в Tribute из tg — в комментарии к платежу надо вставить его <b>код платежа</b> (он указан у него в <a href="/profile/topup">/profile/topup</a>). Так мы точно знаем, какому читателю начислять.</li>
          </ol>
        </details>

        <div style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleRegen}
            disabled={busy}
          >
            🔁 Сгенерировать новый токен
          </button>
        </div>
      </section>

      {/* --- Boosty block --- */}
      <section className="payout-block">
        <div className="payout-block-head">
          <span className="payout-icon" aria-hidden="true">🪐</span>
          <div>
            <h2>Boosty</h2>
            <p className="payout-block-sub">
              Официального API и webhook у Boosty нет. Поэтому пока так:
              ты указываешь ссылку на свою страницу, читатель переходит,
              платит напрямую. Активация подписки на chaptify — вручную
              (админ) или по коду в комментарии к донату.
            </p>
          </div>
          {initial.boostyLastSyncAt && (
            <span className="payout-health payout-health--amber">
              Последняя сверка: {timeAgo(initial.boostyLastSyncAt)}
            </span>
          )}
        </div>

        <div className="form-field">
          <label title="Ссылка на твою страницу Boosty, куда будет вести кнопка «Подписаться»">
            Ссылка на Boosty
          </label>
          <input
            type="url"
            className="form-input"
            value={boostyUrl}
            onChange={(e) => setBoostyUrl(e.target.value)}
            placeholder="https://boosty.to/alenasubbota"
          />
          <div className="form-hint">
            Кнопка «Подписаться на Boosty» на твоей странице переводчика ведёт сюда.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleBoostyUrlSave}
            disabled={busy}
          >
            Сохранить
          </button>
        </div>

        <details className="payout-details" style={{ marginTop: 18 }}>
          <summary>Почему у Boosty нет авто-сверки</summary>
          <p style={{ marginTop: 10, color: 'var(--ink-soft)', lineHeight: 1.55 }}>
            У Boosty нет публичного API. Все сторонние библиотеки работают через
            скрейпинг: они просят твои куки от браузера, залогиненного в Boosty,
            и делают через них GraphQL-запросы. Это неудобно (куки живут ~месяц)
            и небезопасно (куки — полный доступ к аккаунту).
          </p>
          <p style={{ marginTop: 8, color: 'var(--ink-soft)', lineHeight: 1.55 }}>
            Мы добавим авто-сверку через куки чуть позже, как опциональную фичу.
            Пока проще: читатель платит → пишет в комментарии свой код с страницы
            пополнения → ты вручную подтверждаешь (или админ).
          </p>
        </details>
      </section>

      {msg && (
        <div
          className="payout-msg"
          style={{
            color: msg.startsWith('Ошибка') ? 'var(--rose)' : 'var(--leaf)',
          }}
        >
          {msg}
        </div>
      )}

      <section className="payout-block">
        <div className="payout-block-head">
          <span className="payout-icon" aria-hidden="true">🎟️</span>
          <div>
            <h2>Платёжные коды читателей</h2>
            <p className="payout-block-sub">
              Если читатель платит через Boosty или Tribute-донат с комментарием —
              в этот комментарий нужно вставить его персональный код со страницы
              <a href="/profile/topup"> /profile/topup</a>. По этому коду мы
              находим нужный аккаунт и начисляем монеты.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
