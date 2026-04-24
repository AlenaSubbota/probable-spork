'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

interface Props {
  novelId: number;
  chapterNumber: number;
  hasTranslator: boolean;
  translatorDisplayName: string | null;
  isLoggedIn: boolean;
}

interface Summary {
  total_count: number;
  total_coins: number;  // оставили в ответе RPC, но новыми «♥» не наращивается
  my_thanked: boolean;
}

// Бесплатное «♥ спасибо» под главой. Одна запись на пару (reader, chapter).
// Денежных чаевых больше нет — по юр-модели chaptify не держит деньги
// между читателем и переводчиком. Эмоциональный сигнал остаётся: у
// переводчика на дашборде копится число «спасиб», а читатель видит их
// под главой. Настоящая монетарная поддержка — подписка / покупка монет
// напрямую у переводчика (см. /t/[slug]).
export default function ChapterThanks({
  novelId,
  chapterNumber,
  hasTranslator: _hasTranslator,
  translatorDisplayName: _translatorDisplayName,
  isLoggedIn,
}: Props) {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
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
    return () => {
      cancelled = true;
    };
  }, [novelId, chapterNumber]);

  const sendThanks = async () => {
    setError(null);
    setMessage(null);
    setBusy(true);
    const supabase = createClient();
    const { data, error: err } = await supabase.rpc('thank_chapter', {
      p_novel: novelId,
      p_chapter: chapterNumber,
      p_tip_coins: 0,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    const res = (data ?? {}) as {
      ok?: boolean;
      error?: string;
      already_thanked?: boolean;
    };
    if (!res.ok) {
      if (res.error === 'not_authenticated') setError('Сначала войди в аккаунт.');
      else setError(res.error ?? 'Не удалось отправить.');
      return;
    }
    setSummary((s) =>
      s
        ? {
            total_count: s.my_thanked ? s.total_count : s.total_count + 1,
            total_coins: s.total_coins,
            my_thanked: true,
          }
        : { total_count: 1, total_coins: 0, my_thanked: true }
    );
    if (!res.already_thanked) {
      setMessage('Переводчик увидит ваш лайк.');
    }
    router.refresh();
  };

  const unthank = async () => {
    setError(null);
    setMessage(null);
    setBusy(true);
    const supabase = createClient();
    const { data, error: err } = await supabase.rpc('untoggle_thank', {
      p_novel: novelId,
      p_chapter: chapterNumber,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    const res = (data ?? {}) as { ok?: boolean; error?: string; removed?: boolean };
    if (!res.ok) {
      setError(res.error ?? 'Не удалось отменить.');
      return;
    }
    if (res.removed) {
      setSummary((s) =>
        s
          ? {
              total_count: Math.max(0, s.total_count - 1),
              total_coins: s.total_coins,
              my_thanked: false,
            }
          : s
      );
      setMessage('Лайк снят.');
    }
    router.refresh();
  };

  const totalCount = summary?.total_count ?? 0;
  const myThanked = summary?.my_thanked ?? false;

  const handleClick = () => {
    if (!isLoggedIn || busy) return;
    if (myThanked) unthank();
    else sendThanks();
  };

  return (
    <section className="chapter-thanks">
      {/* Inline-стили для центрирования поверх существующих классов в
          globals.css. Раньше кнопка «♥ Спасибо» прижималась к правому
          краю через justify-content: space-between — на широких экранах
          между счётчиком и кнопкой зияло пустое место, на узких они
          жались. Теперь: счётчик сверху, кнопка под ним по центру. */}
      <div
        className="chapter-thanks-head"
        style={{
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
        }}
      >
        <div className="chapter-thanks-counter" style={{ justifyContent: 'center' }}>
          <span className="chapter-thanks-heart" aria-hidden="true">
            {myThanked ? '❤' : '♡'}
          </span>
          <span>
            {totalCount > 0
              ? `${totalCount} ${pluralRu(totalCount, 'спасибо', 'спасиба', 'спасибо')}`
              : 'Скажи переводчику спасибо'}
          </span>
        </div>

        {!isLoggedIn ? (
          <Link href="/login" className="btn btn-ghost">
            Войти, чтобы поблагодарить
          </Link>
        ) : (
          /* Симметричные лейблы «♥ Спасибо» / «✓ Спасибо» одинаковой длины —
             кнопка при toggle не прыгает и не сдвигает соседние блоки. */
          <button
            type="button"
            className={`btn ${myThanked ? 'btn-ghost' : 'btn-primary'} chapter-thanks-btn`}
            onClick={handleClick}
            disabled={busy}
            title={myThanked ? 'Нажми, чтобы снять' : 'Бесплатное «спасибо»'}
          >
            {myThanked ? '✓ Спасибо' : '♥ Спасибо'}
          </button>
        )}
      </div>

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
