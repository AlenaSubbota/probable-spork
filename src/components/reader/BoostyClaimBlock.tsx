'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { useToasts, ToastStack } from '@/components/ui/Toast';

interface Props {
  translatorId: string;
  translatorName: string;
  boostyUrl: string | null;
  /** Если у читателя уже есть pending-claim — передаём сюда, чтобы показать код и статус. */
  existingClaim?: {
    id: number;
    code: string;
    status: 'pending' | 'approved' | 'declined';
    external_username: string | null;
    tier_months: number;
  } | null;
}

// Блок на paywall: «открыть платные главы через Boosty-подписку».
// Чтение флоу:
//   1. Клик «Оплатить на Boosty» — уходит на Boosty
//   2. После оплаты — возврат, «У меня есть подписка» → форма
//   3. Читатель вводит свой Boosty-ник и нажимает «Отправить заявку»
//   4. Генерируется уникальный код (C-XXXXXXXX) — его нужно написать
//      переводчику в ЛС или в комменте к посту. Переводчик сверяет и
//      подтверждает одну кнопкой — открывается доступ.
export default function BoostyClaimBlock({
  translatorId,
  translatorName,
  boostyUrl,
  existingClaim,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [externalName, setExternalName] = useState('');
  const [note, setNote] = useState('');
  const [tierMonths, setTierMonths] = useState(1);
  const [claim, setClaim] = useState(existingClaim ?? null);
  const { items: toasts, push, dismiss } = useToasts();

  const handleSubmit = async () => {
    if (externalName.trim().length < 2) {
      push('error', 'Напиши свой ник на Boosty — переводчику так проще найти тебя.');
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('submit_subscription_claim', {
      p_translator_id: translatorId,
      p_provider:      'boosty',
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

  // Если нет Boosty-URL — блок не показываем (paywall решит что рисовать)
  if (!boostyUrl) return null;

  return (
    <div className="boosty-claim-block">
      <div className="boosty-claim-head">
        <div>
          <div className="boosty-claim-title">
            Открыть через подписку на Boosty
          </div>
          <div className="boosty-claim-sub">
            {translatorName} получает оплату напрямую через Boosty.
            Chaptify только сверит, что ты подписан(а), и откроет все платные главы.
          </div>
        </div>
      </div>

      {claim ? (
        <ClaimStatus claim={claim} />
      ) : open ? (
        <div className="boosty-claim-form">
          <ol className="boosty-claim-steps">
            <li>
              Подпишись на Boosty по ссылке переводчика (если ещё нет).
            </li>
            <li>
              Отправь заявку здесь — получишь <strong>уникальный код</strong>.
            </li>
            <li>
              Напиши этот код {translatorName} в личку Boosty или в комменте
              к посту. Так переводчик поймёт, какой ты аккаунт на chaptify.
            </li>
            <li>
              Переводчик одобрит — платные главы откроются автоматически.
            </li>
          </ol>

          <div className="form-field">
            <label>Твой ник на Boosty *</label>
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
            <div className="form-hint">
              От этого зависит, на сколько откроется доступ.
            </div>
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
        <div className="boosty-claim-cta">
          <a
            href={boostyUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="btn btn-primary"
          >
            Оплатить на Boosty →
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

function ClaimStatus({ claim }: { claim: NonNullable<Props['existingClaim']> }) {
  if (claim.status === 'pending') {
    return (
      <div className="boosty-claim-pending">
        <div className="boosty-claim-pending-head">
          📨 Заявка отправлена · ждём одобрения
        </div>
        <div className="boosty-claim-pending-sub">
          Напиши этот код переводчику в личку Boosty или в комменте:
        </div>
        <div className="boosty-claim-code">{claim.code}</div>
        <div className="boosty-claim-pending-sub">
          Твой ник: <strong>@{claim.external_username}</strong>{' '}
          · срок: {claim.tier_months} мес.
        </div>
        <div className="boosty-claim-pending-hint">
          Как только переводчик одобрит — получишь уведомление, и платные
          главы откроются. Обычно в течение дня.
        </div>
      </div>
    );
  }
  if (claim.status === 'approved') {
    return (
      <div className="boosty-claim-approved">
        ✓ Подписка активна. Главы открыты.
      </div>
    );
  }
  return (
    <div className="boosty-claim-declined">
      <div>✗ Заявка отклонена переводчиком.</div>
      <Link href="#" onClick={(e) => { e.preventDefault(); window.location.reload(); }}>
        Попробовать снова
      </Link>
    </div>
  );
}
