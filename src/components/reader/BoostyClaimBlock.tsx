'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { useToasts, ToastStack } from '@/components/ui/Toast';

export type Provider = 'boosty' | 'tribute' | 'vk_donut' | 'patreon' | 'other';

export interface PaymentMethod {
  id: number;
  provider: Provider;
  url: string;
  instructions: string | null;
}

const PROVIDER_META: Record<Provider, {
  label: string;
  icon: string;
  color: string;    // акцент карточки
}> = {
  boosty:   { label: 'Boosty',   icon: '💛', color: '#ffc839' },
  tribute:  { label: 'Tribute',  icon: '💰', color: '#f8b04a' },
  vk_donut: { label: 'VK Donut', icon: '🟦', color: '#4a76a8' },
  patreon:  { label: 'Patreon',  icon: '🧡', color: '#ff424d' },
  other:    { label: 'Другое',   icon: '✨', color: '#a06a4d' },
};

interface Props {
  translatorId: string;
  translatorName: string;
  method: PaymentMethod;
  existingClaim?: {
    id: number;
    code: string;
    status: 'pending' | 'approved' | 'declined';
    external_username: string | null;
    tier_months: number;
  } | null;
}

// Карточка одного способа оплаты. Флоу:
//   1. Клик «Оплатить на <платформе>» — уходит на внешнюю ссылку
//   2. После оплаты — возврат, «У меня есть подписка» → форма
//   3. Читатель вводит свой ник на платформе и нажимает «Отправить»
//   4. Переводчик получает уведомление → одобряет в /admin/subscribers
//      → подписка активируется и все платные главы открываются.
export default function ClaimBlock({
  translatorId,
  translatorName,
  method,
  existingClaim,
}: Props) {
  const meta = PROVIDER_META[method.provider];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [externalName, setExternalName] = useState('');
  const [note, setNote] = useState('');
  const [tierMonths, setTierMonths] = useState(1);
  const [claim, setClaim] = useState(existingClaim ?? null);
  const { items: toasts, push, dismiss } = useToasts();

  const handleSubmit = async () => {
    if (externalName.trim().length < 2) {
      push('error', `Напиши свой ник на ${meta.label} — переводчику так проще найти тебя.`);
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('submit_subscription_claim', {
      p_translator_id: translatorId,
      p_provider:      method.provider,
      p_external:      externalName.trim(),
      p_note:          note.trim() || null,
      p_tier_months:   tierMonths,
    });
    setBusy(false);
    if (error) {
      push('error', `Не отправилось: ${error.message}`);
      return;
    }
    const res = (data ?? {}) as {
      ok?: boolean;
      error?: string;
      claim?: {
        id: number;
        code: string;
        status: 'pending' | 'approved' | 'declined';
        external_username: string | null;
        tier_months: number;
      };
    };
    if (!res.ok || !res.claim) {
      push('error', res.error === 'cannot_claim_self'
        ? 'Нельзя заявить подписку на самого себя.'
        : `Не получилось: ${res.error ?? 'unknown'}`);
      return;
    }
    setClaim(res.claim);
    push('success', 'Заявка отправлена. Переводчику пришло уведомление.');
  };

  return (
    <div className="claim-block" style={{ borderLeftColor: meta.color }}>
      <div className="claim-block-head">
        <span className="claim-block-icon" aria-hidden="true">{meta.icon}</span>
        <div>
          <div className="claim-block-title">
            Подписка на {meta.label}
          </div>
          <div className="claim-block-sub">
            {method.instructions
              ? method.instructions
              : `${translatorName} получает оплату напрямую через ${meta.label}.`}
          </div>
        </div>
      </div>

      {claim ? (
        <ClaimStatus claim={claim} providerLabel={meta.label} />
      ) : open ? (
        <div className="claim-form">
          <ol className="claim-steps">
            <li>Подпишись по ссылке переводчика (если ещё нет).</li>
            <li>Отправь заявку здесь — получишь <strong>уникальный код</strong>.</li>
            <li>
              Напиши этот код переводчику в личку {meta.label} или в комменте
              к посту. Так он/она свяжет твой аккаунт с chaptify.
            </li>
            <li>Переводчик одобрит — доступ откроется автоматически.</li>
          </ol>

          <div className="form-field">
            <label>Твой ник на {meta.label} *</label>
            <input
              className="form-input"
              value={externalName}
              onChange={(e) => setExternalName(e.target.value)}
              maxLength={120}
              placeholder="Например, alena-chan"
            />
          </div>

          <div className="form-field">
            <label>На сколько месяцев подписался(ась)</label>
            <select
              className="form-input"
              value={tierMonths}
              onChange={(e) => setTierMonths(parseInt(e.target.value, 10))}
              style={{ maxWidth: 200 }}
            >
              <option value={1}>1 месяц</option>
              <option value={3}>3 месяца</option>
              <option value={6}>6 месяцев</option>
              <option value={12}>12 месяцев</option>
            </select>
          </div>

          <div className="form-field">
            <label>Доп. коммент переводчику (необязательно)</label>
            <input
              className="form-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder='Например: "оплатила тир «Патрон»"'
            />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={busy}
            >
              {busy ? 'Отправляем…' : 'Отправить заявку'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <div className="claim-cta">
          <a
            href={method.url}
            target="_blank"
            rel="noreferrer noopener"
            className="btn btn-primary"
          >
            Оплатить на {meta.label} →
          </a>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setOpen(true)}
          >
            Уже подписан(а)? Отправить код
          </button>
        </div>
      )}

      <ToastStack items={toasts} onDismiss={dismiss} />
    </div>
  );
}

function ClaimStatus({
  claim,
  providerLabel,
}: {
  claim: NonNullable<Props['existingClaim']>;
  providerLabel: string;
}) {
  if (claim.status === 'pending') {
    return (
      <div className="claim-pending">
        <div className="claim-pending-head">📨 Заявка отправлена · ждём одобрения</div>
        <div className="claim-pending-sub">
          Напиши этот код переводчику в {providerLabel}:
        </div>
        <div className="claim-code">{claim.code}</div>
        <div className="claim-pending-sub">
          Твой ник: <strong>@{claim.external_username}</strong> · срок: {claim.tier_months} мес.
        </div>
        <div className="claim-pending-hint">
          Как только переводчик одобрит — получишь уведомление. Обычно в
          течение дня.
        </div>
      </div>
    );
  }
  if (claim.status === 'approved') {
    return (
      <div className="claim-approved">
        ✓ Подписка активна. Главы открыты.
      </div>
    );
  }
  return (
    <div className="claim-declined">
      <div>✗ Заявка отклонена переводчиком.</div>
      <Link href="#" onClick={(e) => { e.preventDefault(); window.location.reload(); }}>
        Попробовать снова
      </Link>
    </div>
  );
}
