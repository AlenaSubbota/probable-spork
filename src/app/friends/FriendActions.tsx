'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { useToasts, ToastStack } from '@/components/ui/Toast';

interface Props {
  otherId: string;
  requestId: number;
  kind: 'friend' | 'incoming' | 'outgoing';
}

export default function FriendActions({ otherId, requestId, kind }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const supabase = createClient();
  const { items: toasts, push, dismiss } = useToasts();

  // Раньше ошибки RPC просто проглатывались — кнопка анимировалась
  // в busy и возвращалась обратно, юзер не понимал, прошло или нет.
  // Теперь любую ошибку показываем тостом.
  const showRpcError = (action: string, err: unknown) => {
    const msg =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : 'неизвестная ошибка';
    push('error', `Не получилось ${action}: ${msg}`);
  };

  const doAccept = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('respond_to_friend_request', {
      p_request_id: requestId,
      p_accept: true,
    });
    setBusy(false);
    if (error) {
      showRpcError('принять заявку', error);
      return;
    }
    router.refresh();
  };

  const doDecline = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('respond_to_friend_request', {
      p_request_id: requestId,
      p_accept: false,
    });
    setBusy(false);
    if (error) {
      showRpcError('отклонить заявку', error);
      return;
    }
    router.refresh();
  };

  const doUnfriend = async () => {
    if (!confirm('Удалить из друзей?')) return;
    setBusy(true);
    const { error } = await supabase.rpc('unfriend', { p_other: otherId });
    setBusy(false);
    if (error) {
      showRpcError('удалить из друзей', error);
      return;
    }
    router.refresh();
  };

  const doCancel = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('unfriend', { p_other: otherId });
    setBusy(false);
    if (error) {
      showRpcError('отменить заявку', error);
      return;
    }
    router.refresh();
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
        <ToastStack items={toasts} onDismiss={dismiss} />
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
        <ToastStack items={toasts} onDismiss={dismiss} />
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
      <ToastStack items={toasts} onDismiss={dismiss} />
    </div>
  );
}
