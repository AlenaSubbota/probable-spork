'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Триггерит router.refresh() при возврате фокуса на вкладку.
// Зачем: SiteHeader — server-component в layout.tsx. Next.js App Router
// кэширует layout при client-side навигации. Значит после внешнего действия
// (оплата в Tribute-вкладке, начисление монет админом и т.п.) шапка остаётся
// со старым балансом, пока пользователь не нажмёт F5.
//
// router.refresh() перезапрашивает только RSC-дерево текущего url без
// потери client-state. Визуально — обновление без мигания: React diff'ит
// виртуальный DOM и заменяет только изменившиеся узлы (число монет).
//
// Слушаем visibilitychange: пользователь ушёл → вернулся → тихий refresh.
export default function HeaderRefreshOnVisibility() {
  const router = useRouter();
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [router]);
  return null;
}
