'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

interface Props {
  novelId: number;
  novelFirebaseId: string;
  novelTitle: string;
  chapterNumber: number;
  chapterPrice: number;     // условно 10 монет
  userBalance: number;
  translatorSlug: string | null;
}

// Показывается вместо текста главы, если глава платная и у пользователя
// нет ни подписки, ни штучной покупки. Два пути: купить за монетки или
// оформить подписку переводчику (выгоднее если будешь читать много).
export default function ChapterPaywall({
  novelId,
  novelFirebaseId,
  novelTitle,
  chapterNumber,
  chapterPrice,
  userBalance,
  translatorSlug,
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
    // RPC возвращает jsonb: { ok, error?, price?, balance?, already_owned? }
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
        Это платная глава. Открой её одним из двух способов.
      </p>

      <div className="paywall-options">
        {/* Вариант 1: разовая покупка */}
        <div className="paywall-option">
          <div className="paywall-option-head">Купить главу</div>
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

        {/* Вариант 2: подписка */}
        <div className="paywall-option paywall-option--highlight">
          <div className="paywall-option-tag">Выгоднее</div>
          <div className="paywall-option-head">Подписаться на переводчика</div>
          <div className="paywall-option-price">
            <span className="paywall-coins">299 ₽</span>
            <span className="paywall-coins-unit">в месяц</span>
          </div>
          <div className="paywall-balance">
            Открываются <strong>все</strong> платные главы этого переводчика
            на месяц вперёд.
          </div>
          {translatorSlug ? (
            <Link
              href={`/t/${translatorSlug}`}
              className="btn btn-ghost"
              style={{ width: '100%' }}
            >
              К странице переводчика
            </Link>
          ) : (
            <Link
              href={`/novel/${novelFirebaseId}`}
              className="btn btn-ghost"
              style={{ width: '100%' }}
            >
              К новелле
            </Link>
          )}
        </div>
      </div>

      <Link href={`/novel/${novelFirebaseId}`} className="paywall-back">
        ← Назад к списку глав
      </Link>
    </div>
  );
}
