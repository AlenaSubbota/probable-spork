'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

interface Props {
  applicationId: number;
}

export default function WithdrawButton({ applicationId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const handle = async () => {
    if (!confirm('Отозвать отклик?')) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from('marketplace_applications')
      .update({ status: 'withdrawn' })
      .eq('id', applicationId);
    setBusy(false);
    if (error) {
      alert(`Ошибка: ${error.message}`);
      return;
    }
    router.refresh();
  };

  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={handle}
      disabled={busy}
    >
      {busy ? '…' : 'Отозвать отклик'}
    </button>
  );
}
