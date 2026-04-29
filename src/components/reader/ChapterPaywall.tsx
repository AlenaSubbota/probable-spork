'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import ClaimBlock, { type PaymentMethod } from './BoostyClaimBlock';

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
  /** Список подключённых переводчиком платформ (только enabled). */
  paymentMethods: PaymentMethod[];
  /** Принимает ли переводчик оплату монетами за главу. */
  acceptsCoins: boolean;
  /** У текущего читателя привязан Telegram — для автосинка. */
  viewerHasTelegram: boolean;
  existingClaim: {
    id: number;
    code: string;
    status: 'pending' | 'approved' | 'declined';
    external_username: string | null;
    tier_months: number;
  } | null;
}

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
  paymentMethods,
  acceptsCoins,
  viewerHasTelegram,
  existingClaim,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Синхронный лок против двойного клика. setBusy(true) — async (стейт
  // обновится только на следующем рендере), и быстрые два таба до
  // re-render'а оба попадают в handleBuy → buy_chapter RPC отрабатывает
  // ОК на второй клик через `already_owned`-ветку, но между чтением
  // балансa с FOR UPDATE и инсертом в chapter_purchases — гонка
  // возможна. Ref сразу видно, никакого ожидания render'а.
  const lockRef = useRef(false);

  const canAfford = userBalance >= chapterPrice;

  const handleBuy = async () => {
    if (lockRef.current) return;
    lockRef.current = true;
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
      lockRef.current = false;
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
          ? `Не хватает монет: нужно ${res.price}, на кошельке у этого переводчика ${res.balance}. Пополни на странице переводчика.`
          : res.error === 'chapter_is_free'
          ? 'Эта глава стала бесплатной — обнови страницу.'
          : res.error === 'external_translator'
          ? 'У этой новеллы внешний переводчик — монеты не работают, только прямая ссылка.'
          : res.error === 'translator_coins_disabled'
          ? 'Переводчик временно отключил оплату монетами за главы. Подписка работает как обычно.'
          : res.error === 'chapter_no_content'
          ? 'Файл главы ещё не загружен переводчиком. Покупка пока невозможна, попробуй позже.'
          : res.error === 'not_authenticated'
          ? 'Сначала войди в аккаунт.'
          : res.error === 'account_pending_deletion'
          ? 'Аккаунт в очереди на удаление — покупки отключены.'
          : res.error ?? 'Не удалось купить главу.';
      setError(msg);
      setBusy(false);
      lockRef.current = false;
      return;
    }
    // На успешной покупке lockRef нарочно НЕ снимаем — router.refresh()
    // подкатит новый paywall-state и компонент перерендерится; до тех
    // пор второй клик уже не имеет смысла.
    router.refresh();
  };

  const hasAnyOption = paymentMethods.length > 0 || acceptsCoins;

  return (
    <div className="paywall">
      <div className="paywall-icon" aria-hidden="true">🔒</div>
      <h2 className="paywall-title">
        Глава {chapterNumber} · «{novelTitle}»
      </h2>
      <p className="paywall-sub">
        {hasAnyOption
          ? 'Это платная глава. Выбери способ — любой из этих открывает доступ.'
          : 'Переводчик пока не настроил оплату. Напиши автору через профиль — он подскажет.'}
      </p>

      {/* Внешние платёжные методы (Boosty, Tribute, VK Donut, …) */}
      {translatorId && paymentMethods.length > 0 && (
        <div className="paywall-claims">
          {paymentMethods.map((m) => (
            <ClaimBlock
              key={m.id}
              translatorId={translatorId}
              translatorName={translatorName ?? 'переводчик'}
              method={m}
              viewerHasTelegram={viewerHasTelegram}
              existingClaim={existingClaim}
            />
          ))}
        </div>
      )}

      <div className="paywall-options">
        {/* Монеты — только если переводчик это принимает */}
        {acceptsCoins && (
          <div className="paywall-option">
            <div className="paywall-option-head">Купить главу за монеты</div>
            <div className="paywall-option-price">
              <span className="paywall-coins">{chapterPrice}</span>
              <span className="paywall-coins-unit">монет</span>
            </div>
            <div className="paywall-balance">
              На кошельке у {translatorName ?? 'переводчика'}:{' '}
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
                href={translatorSlug ? `/t/${translatorSlug}` : '/profile/topup'}
                className="btn btn-primary"
                style={{ width: '100%' }}
              >
                Пополнить у {translatorName ?? 'переводчика'}
              </Link>
            )}
            {error && (
              <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 8 }}>
                {error}
              </div>
            )}
          </div>
        )}

        {translatorSlug && (
          <div className="paywall-option paywall-option--mini">
            <div className="paywall-option-head">Все способы и контакты</div>
            <div className="paywall-balance" style={{ marginBottom: 8 }}>
              Страница переводчика — там все его ссылки и способы связи.
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
