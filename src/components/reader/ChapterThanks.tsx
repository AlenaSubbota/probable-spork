'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

interface Props {
  novelId: number;
  chapterNumber: number;
  hasTranslator: boolean;        // есть ли translator_id у новеллы
  translatorDisplayName: string | null;
  isLoggedIn: boolean;
}

interface Summary {
  total_count: number;
  total_coins: number;
  my_thanked: boolean;
}

const TIP_PRESETS = [1, 2, 5, 10] as const;

// Блок под главой «спасибо + чаевые переводчику».
// Лайк — бесплатный, хранится один на пару (reader, chapter).
// Чаевые — любая сумма из пресетов или своя; атомарно списывается с
// баланса, добавляется переводчику. RPC — thank_chapter (миграция 025).
export default function ChapterThanks({
  novelId,
  chapterNumber,
  hasTranslator,
  translatorDisplayName,
  isLoggedIn,
}: Props) {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const [pickedTip, setPickedTip] = useState<number>(2);
  const [customTip, setCustomTip] = useState<string>('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .rpc('chapter_thanks_summary', {
        p_novel: novelId,
        p_chapter: chapterNumber,
      })
      .then(({ data }) => {
        if (cancelled || !data) return;
        setSummary(data as Summary);
      });
    return () => { cancelled = true; };
  }, [novelId, chapterNumber]);

  const sendThanks = async (tipCoins: number) => {
    setError(null);
    setMessage(null);
    setBusy(true);
    const supabase = createClient();
    const { data, error: err } = await supabase.rpc('thank_chapter', {
      p_novel: novelId,
      p_chapter: chapterNumber,
      p_tip_coins: tipCoins,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    const res = (data ?? {}) as {
      ok?: boolean;
      error?: string;
      balance?: number;
      needed?: number;
      tip_sent?: number;
      already_thanked?: boolean;
    };
    if (!res.ok) {
      if (res.error === 'insufficient_balance') {
        setError(
          `Не хватает монет: нужно ${res.needed}, на счету ${res.balance ?? 0}.`
        );
      } else if (res.error === 'not_authenticated') {
        setError('Сначала войди в аккаунт.');
      } else {
        setError(res.error ?? 'Не удалось отправить.');
      }
      return;
    }
    setSummary((s) =>
      s
        ? {
            total_count: s.my_thanked ? s.total_count : s.total_count + 1,
            total_coins: s.total_coins + (res.tip_sent ?? 0),
            my_thanked: true,
          }
        : s
    );
    if (res.tip_sent && res.tip_sent > 0) {
      setMessage(`Отправлено +${res.tip_sent} монет переводчику. Спасибо!`);
      setTipOpen(false);
    } else if (!res.already_thanked) {
      setMessage('Переводчик увидит ваш лайк.');
    }
    router.refresh();
  };

  const handleLike = () => {
    if (!isLoggedIn) return;
    sendThanks(0);
  };

  const handleTip = () => {
    if (!isLoggedIn) return;
    const custom = parseInt(customTip, 10);
    const amount = Number.isFinite(custom) && custom > 0 ? custom : pickedTip;
    if (amount < 1 || amount > 500) {
      setError('Сумма должна быть от 1 до 500 монет.');
      return;
    }
    sendThanks(amount);
  };

  const totalCount = summary?.total_count ?? 0;
  const totalCoins = summary?.total_coins ?? 0;
  const myThanked = summary?.my_thanked ?? false;

  return (
    <section className="chapter-thanks">
      <div className="chapter-thanks-head">
        <div className="chapter-thanks-counter">
          <span className="chapter-thanks-heart" aria-hidden="true">
            {myThanked ? '❤' : '♡'}
          </span>
          <span>
            {totalCount > 0
              ? `${totalCount} ${pluralRu(totalCount, 'спасибо', 'спасиба', 'спасибо')}`
              : 'Скажи переводчику спасибо'}
          </span>
          {totalCoins > 0 && (
            <span className="chapter-thanks-coins" title="Собрано чаевых">
              +{totalCoins}
            </span>
          )}
        </div>

        {!isLoggedIn ? (
          <Link href="/login" className="btn btn-ghost">
            Войти, чтобы поблагодарить
          </Link>
        ) : (
          <div className="chapter-thanks-actions">
            <button
              type="button"
              className={`btn ${myThanked ? 'btn-ghost' : 'btn-primary'}`}
              onClick={handleLike}
              disabled={busy}
              title={myThanked ? 'Ты уже благодарил(а) за эту главу' : 'Бесплатно'}
            >
              {myThanked ? '✓ Уже поблагодарил(а)' : '♥ Спасибо'}
            </button>
            {hasTranslator && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setTipOpen((v) => !v)}
                disabled={busy}
                title="Перевести монеты переводчику"
              >
                {tipOpen ? 'Свернуть' : '💝 Чаевые'}
              </button>
            )}
          </div>
        )}
      </div>

      {tipOpen && isLoggedIn && (
        <div className="chapter-thanks-tip">
          <div className="chapter-thanks-tip-head">
            Поблагодарить
            {translatorDisplayName ? ` ${translatorDisplayName}` : ' переводчика'}{' '}
            монетами
          </div>
          <div className="chapter-thanks-presets">
            {TIP_PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                className={`chapter-thanks-preset${
                  pickedTip === n && !customTip ? ' is-active' : ''
                }`}
                onClick={() => {
                  setPickedTip(n);
                  setCustomTip('');
                }}
              >
                +{n}
              </button>
            ))}
            <div className="chapter-thanks-custom">
              <input
                type="number"
                className="form-input"
                placeholder="Своё"
                min={1}
                max={500}
                value={customTip}
                onChange={(e) => setCustomTip(e.target.value)}
              />
              <span>монет</span>
            </div>
          </div>
          <div className="admin-form-footer" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleTip}
              disabled={busy}
            >
              {busy ? 'Отправляем…' : 'Отправить'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setTipOpen(false)}
              disabled={busy}
            >
              Отмена
            </button>
          </div>
          <p className="chapter-thanks-hint">
            Монеты уходят переводчику напрямую. Пополнить баланс:{' '}
            <Link href="/profile/topup" className="more">
              /profile/topup
            </Link>
            .
          </p>
        </div>
      )}

      {error && <div className="chapter-thanks-error">{error}</div>}
      {message && <div className="chapter-thanks-message">{message}</div>}
    </section>
  );
}

function pluralRu(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
