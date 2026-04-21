'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import type { FriendshipStatus } from '@/lib/social';

interface Props {
  otherUserId: string;
  initialStatus: FriendshipStatus;
  otherSlug?: string | null;   // для ссылки «Написать»
}

export default function FriendshipButton({
  otherUserId,
  initialStatus,
  otherSlug,
}: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<FriendshipStatus>(initialStatus);
  const [busy, setBusy] = useState(false);

  const sendRequest = async () => {
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('send_friend_request', {
      p_to: otherUserId,
    });
    if (!error && data) {
      const newStatus: FriendshipStatus =
        data.status === 'accepted' ? 'friends' : 'pending_outgoing';
      setStatus(newStatus);
      router.refresh();
    }
    setBusy(false);
  };

  const accept = async () => {
    setBusy(true);
    const supabase = createClient();
    // Находим id запроса, где addressee = я, requester = other
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: req } = await supabase
      .from('friendships')
      .select('id')
      .eq('requester_id', otherUserId)
      .eq('addressee_id', user.id)
      .eq('status', 'pending')
      .maybeSingle();

    if (req) {
      await supabase.rpc('respond_to_friend_request', {
        p_request_id: req.id,
        p_accept: true,
      });
      setStatus('friends');
      router.refresh();
    }
    setBusy(false);
  };

  const decline = async () => {
    setBusy(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: req } = await supabase
      .from('friendships')
      .select('id')
      .eq('requester_id', otherUserId)
      .eq('addressee_id', user.id)
      .eq('status', 'pending')
      .maybeSingle();
    if (req) {
      await supabase.rpc('respond_to_friend_request', {
        p_request_id: req.id,
        p_accept: false,
      });
      setStatus('declined');
      router.refresh();
    }
    setBusy(false);
  };

  const unfriend = async () => {
    if (!confirm('Удалить из друзей?')) return;
    setBusy(true);
    const supabase = createClient();
    await supabase.rpc('unfriend', { p_other: otherUserId });
    setStatus('none');
    router.refresh();
    setBusy(false);
  };

  const cancelRequest = async () => {
    setBusy(true);
    const supabase = createClient();
    await supabase.rpc('unfriend', { p_other: otherUserId });
    setStatus('none');
    router.refresh();
    setBusy(false);
  };

  if (status === 'friends') {
    return (
      <div className="friendship-actions">
        <Link href={`/messages/${otherUserId}`} className="btn btn-primary">
          ✉ Написать
        </Link>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={unfriend}
          disabled={busy}
        >
          Вы друзья
        </button>
      </div>
    );
  }

  if (status === 'pending_outgoing') {
    return (
      <button
        type="button"
        className="btn btn-ghost"
        onClick={cancelRequest}
        disabled={busy}
      >
        Запрос отправлен · отменить
      </button>
    );
  }

  if (status === 'pending_incoming') {
    return (
      <div className="friendship-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={accept}
          disabled={busy}
        >
          Принять заявку
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={decline}
          disabled={busy}
        >
          Отклонить
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="btn btn-primary"
      onClick={sendRequest}
      disabled={busy}
    >
      + Добавить в друзья
    </button>
  );
}
