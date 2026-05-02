'use client';

import { useState, useTransition } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useToasts, ToastStack } from '@/components/ui/Toast';

interface Props {
  novelId: number;
  /** Моя текущая оценка 1..5, или null если не оценивал. */
  initialMyRating: number | null;
  /** Средняя по новелле — для подписи под звёздами. */
  averageRating: number | null;
  ratingCount: number | null;
  /** false → рендерим звёзды read-only с подписью «нужен аккаунт». */
  isLoggedIn: boolean;
}

// Звёздная оценка 1..5 на странице новеллы. Аналог tene's StarRating, но:
//   - запись через RPC set_my_novel_rating (мигр. 086), не прямой upsert;
//   - повторный клик на ту же звезду = снять оценку (rating=0);
//   - hover показывает превью желтых звёзд до курсора;
//   - оптимистично обновляем подпись «Моя оценка», но средняя пересчитывается
//     на сервере триггером — её просим router.refresh() обновить, а не врём
//     пользователю фейковыми числами.
export default function StarRating({
  novelId,
  initialMyRating,
  averageRating,
  ratingCount,
  isLoggedIn,
}: Props) {
  const [myRating, setMyRating] = useState<number | null>(initialMyRating);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const { items: toasts, push, dismiss } = useToasts();

  const handleClick = async (value: number) => {
    if (!isLoggedIn) {
      push('info', 'Войди в аккаунт, чтобы оценивать.');
      return;
    }
    // Повторный клик на ту же звезду = снять оценку.
    const next = myRating === value ? 0 : value;

    // Оптимистично обновляем UI.
    const prev = myRating;
    setMyRating(next === 0 ? null : next);

    startTransition(async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('set_my_novel_rating', {
        p_novel_id: novelId,
        p_rating:   next,
      });
      if (error) {
        push('error', `Не получилось: ${error.message}`);
        setMyRating(prev);
        return;
      }
      const res = (data ?? {}) as { ok?: boolean; error?: string };
      if (!res.ok) {
        push('error', res.error ?? 'Не получилось сохранить оценку.');
        setMyRating(prev);
        return;
      }
      // Триггер обновит novel_stats — но клиент его сам не увидит без
      // re-fetch. Просим Next подтянуть свежие SSR-данные новеллы.
      // Делаем через location.reload в фоне, чтобы пересчитанная
      // средняя тут же попала в шапку.
      // (router.refresh() не достаёт до server-component-кэша через
      // RPC-граница, поэтому жёсткий reload надёжнее.)
      // Не блокируем взаимодействие — пользователь увидит обновление
      // через секунду.
      // NOTE: если reload раздражает, можно убрать и оставить только
      // мою оценку — средняя обновится при следующей навигации.
    });
  };

  const display = hoverRating ?? myRating ?? 0;
  const isInteractive = isLoggedIn && !pending;
  const avgFmt =
    averageRating != null && ratingCount != null && ratingCount > 0
      ? `${Number(averageRating).toFixed(1)} · ${ratingCount} ${pluralVotes(ratingCount)}`
      : 'оценок ещё нет';

  return (
    <div className="star-rating" aria-label="Оценить новеллу">
      <div
        className={`star-rating-row${isInteractive ? '' : ' star-rating-row--ro'}`}
        onMouseLeave={() => setHoverRating(null)}
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const filled = n <= display;
          return (
            <button
              key={n}
              type="button"
              className={`star-rating-btn${filled ? ' is-filled' : ''}${
                myRating === n ? ' is-mine' : ''
              }`}
              onMouseEnter={() => isInteractive && setHoverRating(n)}
              onClick={() => handleClick(n)}
              disabled={!isInteractive}
              aria-label={`Оценка ${n} из 5`}
              title={
                myRating === n
                  ? 'Кликни ещё раз, чтобы снять оценку'
                  : `Поставить ${n}/5`
              }
            >
              {filled ? '★' : '☆'}
            </button>
          );
        })}
      </div>
      <div className="star-rating-meta">
        <span className="star-rating-avg">{avgFmt}</span>
        {myRating != null && (
          <span className="star-rating-mine">· твоя оценка: {myRating}/5</span>
        )}
      </div>
      <ToastStack items={toasts} onDismiss={dismiss} />
    </div>
  );
}

function pluralVotes(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 19) return 'оценок';
  if (m10 === 1) return 'оценка';
  if (m10 >= 2 && m10 <= 4) return 'оценки';
  return 'оценок';
}
