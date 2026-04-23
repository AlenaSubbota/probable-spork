'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import BoostyClaimBlock from './BoostyClaimBlock';

interface Props {
  novelId: number;
  novelFirebaseId: string;
  novelTitle: string;
  chapterNumber: number;
  chapterPrice: number;
  userBalance: number;
  translatorSlug: string | null;
  translatorId: string | null;
  translatorName: string | null;
  translatorBoostyUrl: string | null;
  existingClaim: {
    id: number;
    code: string;
    status: 'pending' | 'approved' | 'declined';
    external_username: string | null;
    tier_months: number;
  } | null;
}

// Показывается вместо текста главы, если глава платная и у пользователя
// нет доступа. Три пути:
//   A. Подписка на Boosty у переводчика + claim-code (если переводчик
//      настроил payout_boosty_url) — рекомендуемый путь, деньги идут
//      переводчику напрямую.
//   B. Купить разово за монеты — внутренняя валюта chaptify (для тех,
//      кто читает редко или не хочет подписки).
//   C. [будущее] Подписка на переводчика через chaptify — пока заглушка.
export default function ChapterPaywall({
  novelId,
  novelFirebaseId,
  novelTitle,
  chapterNumber,
  chapterPrice,
  userBalance,
  translatorSlug,
  translatorId,
  translatorName,
  translatorBoostyUrl,
  existingClaim,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAfford = userBalance >= chapterPrice;

  const handleBuy = async () => {
    setError(null);
    setBusy(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc('buy_chapter', {
      p_novel: novelId,
      p_chapter: chapterNumber,
    });

    if (rpcError) {
      setError(rpcError.message);
      setBusy(false);
      return;
    }
    const res = (data ?? {}) as {
      ok?: boolean;
      error?: string;
      price?: number;
      balance?: number;
    };
    if (!res.ok) {
      const msg =
        res.error === 'insufficient_balance'
          ? `Не хватает монет: нужно ${res.price}, на счету ${res.balance}.`
          : res.error === 'chapter_is_free'
          ? 'Эта глава стала бесплатной — обнови страницу.'
          : res.error === 'not_authenticated'
          ? 'Сначала войди в аккаунт.'
          : res.error ?? 'Не удалось купить главу.';
      setError(msg);
      setBusy(false);
      return;
    }
    router.refresh();
  };

  return (
    <div className="paywall">
      <div className="paywall-icon" aria-hidden="true">🔒</div>
      <h2 className="paywall-title">
        Глава {chapterNumber} · «{novelTitle}»
      </h2>
      <p className="paywall-sub">
        Это платная глава. Открой её одним из способов ниже.
      </p>

      {/* Вариант A: подписка на Boosty — если переводчик её настроил */}
      {translatorId && translatorBoostyUrl && (
        <BoostyClaimBlock
          translatorId={translatorId}
          translatorName={translatorName ?? 'переводчик'}
          boostyUrl={translatorBoostyUrl}
          existingClaim={existingClaim}
        />
      )}

      <div className="paywall-options">
        {/* Вариант B: разовая покупка за монеты */}
        <div className="paywall-option">
          <div className="paywall-option-head">Купить главу за монеты</div>
          <div className="paywall-option-price">
            <span className="paywall-coins">{chapterPrice}</span>
            <span className="paywall-coins-unit">монет</span>
          </div>
          <div className="paywall-balance">
            На счету:{' '}
            <strong className={canAfford ? '' : 'paywall-balance--low'}>
              {userBalance.toLocaleString('ru-RU')}
            </strong>{' '}
            монет
          </div>
          {canAfford ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleBuy}
              disabled={busy}
              style={{ width: '100%' }}
            >
              {busy ? 'Покупаем…' : `Купить за ${chapterPrice} монет`}
            </button>
          ) : (
            <Link
              href="/profile/topup"
              className="btn btn-primary"
              style={{ width: '100%' }}
            >
              Пополнить баланс
            </Link>
          )}
          {error && (
            <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 8 }}>
              {error}
            </div>
          )}
        </div>

        {/* Вариант C: ссылка на переводчика */}
        {translatorSlug && (
          <div className="paywall-option paywall-option--mini">
            <div className="paywall-option-head">Посмотреть все способы</div>
            <div className="paywall-balance" style={{ marginBottom: 8 }}>
              Страница переводчика — там может быть Boosty, Telegram и другое.
            </div>
            <Link
              href={`/t/${translatorSlug}`}
              className="btn btn-ghost"
              style={{ width: '100%' }}
            >
              К {translatorName ?? 'переводчику'}
            </Link>
          </div>
        )}
      </div>

      <Link href={`/novel/${novelFirebaseId}`} className="paywall-back">
        ← Назад к списку глав
      </Link>
    </div>
  );
}
