'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useToasts, ToastStack } from '@/components/ui/Toast';

interface PaymentMethod {
  id: number;
  provider: 'boosty' | 'tribute' | 'vk_donut' | 'patreon' | 'other';
  url: string;
  instructions: string | null;
}

interface Props {
  translatorId: string;
  translatorName: string;
  acceptsCoins: boolean;
  paymentMethods: PaymentMethod[];
  /** Есть ли уже pending-заявка на монеты у этого переводчика */
  pendingClaim: {
    id: number;
    code: string;
    coins_amount: number;
    provider: string;
  } | null;
  /** Если читатель не залогинен — скрываем блок */
  isLoggedIn: boolean;
  isSelf: boolean;
}

const PROVIDER_META: Record<PaymentMethod['provider'], { label: string; icon: string }> = {
  boosty:   { label: 'Boosty',    icon: '💛' },
  tribute:  { label: 'Tribute',   icon: '💰' },
  vk_donut: { label: 'VK Donut',  icon: '🟦' },
  patreon:  { label: 'Patreon',   icon: '🧡' },
  other:    { label: 'Другое',    icon: '✨' },
};

// Кошелёк читателя у конкретного переводчика. Показывается на /t/[slug].
// Логика:
//   1. При загрузке — RPC my_balance_with(translator_id) → текущий баланс
//   2. Кнопка «Пополнить» открывает форму: сколько монет + выбор платформы
//      + код для отправки переводчику
//   3. После submit — RPC submit_coins_claim → показывается код,
//      переводчик одобряет в /admin/subscribers и баланс зачисляется.
//
// Если у переводчика accepts_coins_for_chapters=false — блок сообщает,
// что монеты у него не работают, только подписка.
export default function TranslatorWallet({
  translatorId,
  translatorName,
  acceptsCoins,
  paymentMethods,
  pendingClaim,
  isLoggedIn,
  isSelf,
}: Props) {
  const { items: toasts, push, dismiss } = useToasts();
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [amount, setAmount] = useState(100);
  const [provider, setProvider] = useState<PaymentMethod['provider']>(
    paymentMethods[0]?.provider ?? 'boosty'
  );
  const [externalName, setExternalName] = useState('');
  const [note, setNote] = useState('');
  const [claim, setClaim] = useState(pendingClaim);

  useEffect(() => {
    if (!isLoggedIn || isSelf) return;
    const supabase = createClient();
    supabase
      .rpc('my_balance_with', { p_translator: translatorId })
      .then(({ data }) => {
        if (typeof data === 'number') setBalance(data);
      });
  }, [isLoggedIn, isSelf, translatorId]);

  if (!isLoggedIn || isSelf) return null;

  const selectedMethod = paymentMethods.find((m) => m.provider === provider);

  const handleSubmit = async () => {
    if (amount < 1 || amount > 100000) {
      push('error', 'Сумма от 1 до 100000 монет.');
      return;
    }
    if (externalName.trim().length < 2) {
      push('error', 'Укажи свой ник на платформе — переводчику так проще сверить.');
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('submit_coins_claim', {
      p_translator_id: translatorId,
      p_provider:      provider,
      p_coins_amount:  amount,
      p_external:      externalName.trim(),
      p_note:          note.trim() || null,
    });
    setBusy(false);
    if (error) {
      push('error', error.message);
      return;
    }
    const res = (data ?? {}) as {
      ok?: boolean;
      error?: string;
      claim?: { id: number; code: string; coins_amount: number; provider: string };
    };
    if (!res.ok || !res.claim) {
      push('error', res.error ?? 'Не получилось');
      return;
    }
    setClaim({
      id: res.claim.id,
      code: res.claim.code,
      coins_amount: res.claim.coins_amount,
      provider: res.claim.provider,
    });
    push('success', 'Заявка отправлена. Жди одобрения переводчиком.');
  };

  return (
    <section className="wallet-block">
      <div className="wallet-head">
        <div>
          <span className="wallet-kicker">кошелёк у этого переводчика</span>
          <div className="wallet-balance">
            <span className="wallet-balance-val">{balance ?? '—'}</span>
            <span className="wallet-balance-unit">монет</span>
          </div>
          <p className="wallet-sub">
            Работают только на новеллах {translatorName}. У каждого переводчика — свой кошелёк.
          </p>
        </div>
        {!claim && !formOpen && acceptsCoins && paymentMethods.length > 0 && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setFormOpen(true)}
          >
            Пополнить
          </button>
        )}
      </div>

      {claim ? (
        <div className="wallet-claim-pending">
          <div className="wallet-claim-pending-head">
            📨 Заявка на {claim.coins_amount} монет отправлена
          </div>
          <p>
            1. Переведи <strong>{translatorName}</strong> любую сумму через{' '}
            <strong>{PROVIDER_META[claim.provider as PaymentMethod['provider']]?.label ?? claim.provider}</strong>.<br />
            2. В комментарии к переводу (или в личке переводчику) напиши код:
          </p>
          <div className="wallet-claim-code">{claim.code}</div>
          <p className="wallet-claim-hint">
            Переводчик сверит и одобрит — баланс пополнится автоматически.
            Chaptify денег не проводит: платёж идёт напрямую переводчику на его
            самозанятую / ИП. Это его налог, его ответственность.
          </p>
        </div>
      ) : !acceptsCoins ? (
        <p className="wallet-off">
          {translatorName} сейчас не принимает оплату монетами за отдельные главы —
          только подписка целиком.
        </p>
      ) : paymentMethods.length === 0 ? (
        <p className="wallet-off">
          {translatorName} ещё не подключил_а способы оплаты. Попробуй позже
          или напиши переводчику в ЛС.
        </p>
      ) : formOpen ? (
        <div className="wallet-form">
          <div className="wallet-form-row">
            <div className="form-field" style={{ flex: 1 }}>
              <label>Сколько монет покупаешь</label>
              <div className="wallet-amount-row">
                {[50, 100, 300, 500, 1000].map((n) => (
                  <button
                    type="button"
                    key={n}
                    className={`wallet-amount-chip${amount === n ? ' is-active' : ''}`}
                    onClick={() => setAmount(n)}
                  >
                    {n}
                  </button>
                ))}
                <input
                  type="number"
                  min={1}
                  max={100000}
                  className="form-input wallet-amount-input"
                  value={amount}
                  onChange={(e) => setAmount(parseInt(e.target.value, 10) || 0)}
                />
              </div>
              <div className="form-hint">
                Сумма в рублях/другой валюте — на усмотрение переводчика. Как
                правило 1 монета ≈ 1 ₽.
              </div>
            </div>
          </div>

          <div className="form-field">
            <label>Куда переводишь деньги</label>
            <div className="wallet-providers-row">
              {paymentMethods.map((m) => {
                const meta = PROVIDER_META[m.provider];
                const active = provider === m.provider;
                return (
                  <button
                    type="button"
                    key={m.id}
                    className={`wallet-provider-chip${active ? ' is-active' : ''}`}
                    onClick={() => setProvider(m.provider)}
                  >
                    <span aria-hidden="true">{meta.icon}</span> {meta.label}
                  </button>
                );
              })}
            </div>
            {selectedMethod && (
              <div className="wallet-provider-link">
                <a href={selectedMethod.url} target="_blank" rel="noreferrer noopener" className="more">
                  Открыть {PROVIDER_META[selectedMethod.provider].label} переводчика ↗
                </a>
                {selectedMethod.instructions && (
                  <div className="wallet-instructions">{selectedMethod.instructions}</div>
                )}
              </div>
            )}
          </div>

          <div className="form-field">
            <label>Твой ник на платформе *</label>
            <input
              className="form-input"
              value={externalName}
              onChange={(e) => setExternalName(e.target.value)}
              placeholder="@alena-chan"
              maxLength={120}
            />
          </div>

          <div className="form-field">
            <label>Коммент переводчику (необязательно)</label>
            <input
              className="form-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder='Например: "оплатила 300 ₽ на Boosty"'
              maxLength={500}
            />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={busy}
            >
              {busy ? 'Отправляем…' : `Создать заявку на ${amount} монет`}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setFormOpen(false)}
              disabled={busy}
            >
              Отмена
            </button>
          </div>
        </div>
      ) : null}

      <ToastStack items={toasts} onDismiss={dismiss} />
    </section>
  );
}
