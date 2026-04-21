'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';

interface Props {
  otherId: string;
  requestId: number;
  kind: 'friend' | 'incoming' | 'outgoing';
}

export default function FriendActions({ otherId, requestId, kind }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const supabase = createClient();

  const doAccept = async () => {
    setBusy(true);
    await supabase.rpc('respond_to_friend_request', {
      p_request_id: requestId,
      p_accept: true,
    });
    router.refresh();
    setBusy(false);
  };

  const doDecline = async () => {
    setBusy(true);
    await supabase.rpc('respond_to_friend_request', {
      p_request_id: requestId,
      p_accept: false,
    });
    router.refresh();
    setBusy(false);
  };

  const doUnfriend = async () => {
    if (!confirm('Удалить из друзей?')) return;
    setBusy(true);
    await supabase.rpc('unfriend', { p_other: otherId });
    router.refresh();
    setBusy(false);
  };

  const doCancel = async () => {
    setBusy(true);
    await supabase.rpc('unfriend', { p_other: otherId });
    router.refresh();
    setBusy(false);
  };

  if (kind === 'incoming') {
    return (
      <div className="friend-actions">
        <button type="button" className="btn btn-primary" onClick={doAccept} disabled={busy}>
          Принять
        </button>
        <button type="button" className="btn btn-ghost" onClick={doDecline} disabled={busy}>
          Отклонить
        </button>
      </div>
    );
  }

  if (kind === 'outgoing') {
    return (
      <div className="friend-actions">
        <span className="friend-status friend-status--dim">ждёт ответа</span>
        <button type="button" className="btn btn-ghost" onClick={doCancel} disabled={busy}>
          Отменить
        </button>
      </div>
    );
  }

  return (
    <div className="friend-actions">
      <Link href={`/messages/${otherId}`} className="btn btn-primary">
        ✉ Написать
      </Link>
      <button type="button" className="btn btn-ghost" onClick={doUnfriend} disabled={busy}>
        Удалить
      </button>
    </div>
  );
}
