'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

interface Props {
  novelId: number;
  variant?: 'primary' | 'ghost';
  compact?: boolean;
}

// Переводчик жмёт → новелла из draft/rejected уходит в pending.
// Триггер в БД сам отправит уведомление всем админам.
export default function SubmitForReviewButton({
  novelId,
  variant = 'primary',
  compact = false,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    const supabase = createClient();
    const { error: rpcErr } = await supabase.rpc('submit_novel_for_review', {
      p_novel: novelId,
    });
    setBusy(false);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    router.refresh();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button
        type="button"
        className={`btn btn-${variant}`}
        onClick={submit}
        disabled={busy}
        style={compact ? { height: 34 } : undefined}
      >
        {busy ? 'Отправляем…' : 'На модерацию'}
      </button>
      {error && (
        <span style={{ color: 'var(--rose)', fontSize: 12 }}>{error}</span>
      )}
    </div>
  );
}
