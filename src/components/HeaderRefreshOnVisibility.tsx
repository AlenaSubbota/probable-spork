'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

// Триггерит router.refresh() при возврате фокуса на вкладку — чтобы шапка
// (server-component) подхватила свежий баланс после, например, Tribute-оплаты.
//
// Safari desktop: router.refresh() на каждый visible может приводить к
// бесконечно висящему loading-индикатору, потому что Safari «показывает»
// вкладку в процессе скролла/свёртывания (visibilityState быстро
// флипается visible→hidden→visible). Поэтому:
//  • refresh только если вкладка была скрыта ≥ 20 секунд (это НЕ прокрутка,
//    а реально ушёл и вернулся);
//  • минимальный интервал 60 сек между refresh-ами;
//  • пропускаем самый первый visible (сам момент инициализации).
export default function HeaderRefreshOnVisibility() {
  const router = useRouter();
  const hiddenAt = useRef<number | null>(null);
  const lastRefresh = useRef<number>(Date.now());

  useEffect(() => {
    const onChange = () => {
      const now = Date.now();
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = now;
        return;
      }
      // visible
      const hiddenFor = hiddenAt.current ? now - hiddenAt.current : 0;
      hiddenAt.current = null;
      if (hiddenFor < 20_000) return;
      if (now - lastRefresh.current < 60_000) return;
      lastRefresh.current = now;
      router.refresh();
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, [router]);

  return null;
}
