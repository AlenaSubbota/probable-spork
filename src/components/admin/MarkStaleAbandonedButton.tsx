'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

// Кнопка только для админов: вызывает RPC mark_stale_translations_abandoned
// (миграция 064). Находит ongoing-новеллы, у которых последняя глава была
// больше N дней назад (по умолчанию 90), и переключает translation_status
// на 'abandoned'. Оригинал-завершённые игнорируются — там, скорее всего,
// переводчик дотянул до конца, просто забыл выставить 'completed'.

interface BumpedRow {
  novel_id: number;
  firebase_id: string;
  title: string;
  last_chapter_at: string | null;
  days_since_last_chap: number;
}

export default function MarkStaleAbandonedButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bumped, setBumped] = useState<BumpedRow[] | null>(null);

  const run = async () => {
    const ok = window.confirm(
      'Найти все ongoing-новеллы, у которых последняя глава была более ' +
        '90 дней назад, и пометить их как «Заброшен»?\n\n' +
        'Новеллы с завершённым оригиналом и frozen/completed-переводы ' +
        'не трогаем.'
    );
    if (!ok) return;

    setError(null);
    setBumped(null);
    setBusy(true);

    const supabase = createClient();
    const { data, error: rpcErr } = await supabase.rpc(
      'mark_stale_translations_abandoned',
      { p_threshold_days: 90 }
    );
    setBusy(false);

    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }

    setBumped((data as BumpedRow[] | null) ?? []);
    router.refresh();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={run}
        disabled={busy}
        title="Пометить как «Заброшен» переводы без новых глав 90+ дней"
      >
        {busy ? 'Считаем…' : '⏸ Заброшенные за 90 дней'}
      </button>
      {error && (
        <span style={{ color: 'var(--rose)', fontSize: 12.5 }}>
          Ошибка: {error}
        </span>
      )}
      {bumped !== null && (
        <span
          style={{
            color: bumped.length === 0 ? 'var(--ink-mute)' : 'var(--leaf)',
            fontSize: 12.5,
          }}
        >
          {bumped.length === 0
            ? 'Кандидатов нет — все переводы свежие.'
            : `Помечено как «Заброшен»: ${bumped.length} ` +
              (bumped.length === 1 ? 'новелла' : 'новелл')}
        </span>
      )}
    </div>
  );
}
