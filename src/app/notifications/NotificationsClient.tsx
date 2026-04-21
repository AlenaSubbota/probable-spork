'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { timeAgo } from '@/lib/format';

export interface Notification {
  id: number;
  type: string;
  text: string;
  target_url: string | null;
  is_read: boolean;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_avatar: string | null;
  group_key: string | null;
  ref_novel_id: number | null;
  group_count: number;   // сколько событий в группе
}

interface Props {
  initial: Notification[];
  filter: string;
}

const FILTERS: Array<{ key: string; label: string }> = [
  { key: 'all',      label: 'Все' },
  { key: 'unread',   label: 'Непрочитанные' },
  { key: 'friends',  label: 'Друзья' },
  { key: 'messages', label: 'Сообщения' },
  { key: 'comments', label: 'Комментарии' },
  { key: 'business', label: 'Подписки' },
];

function iconFor(type: string): string {
  switch (type) {
    case 'message':         return '✉';
    case 'friend_request':  return '👋';
    case 'friend_accepted': return '🤝';
    case 'comment_reply':   return '💬';
    case 'comment_like':    return '❤';
    case 'new_subscriber':  return '💝';
    case 'new_chapter':     return '📖';
    default:                return '🔔';
  }
}

export default function NotificationsClient({ initial, filter }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [items, setItems] = useState<Notification[]>(initial);
  const [busy, setBusy] = useState(false);

  const unreadCount = items.filter((n) => !n.is_read).length;

  const markAllRead = async () => {
    if (unreadCount === 0) return;
    setBusy(true);
    await supabase.rpc('mark_all_notifications_read');
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    router.refresh();
    setBusy(false);
  };

  const markOneRead = async (id: number) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
  };

  // Киллер-фича #3: inline-кнопки для friend_request
  const acceptFriend = async (actorId: string, notifId: number) => {
    setBusy(true);
    const { data: req } = await supabase
      .from('friendships')
      .select('id')
      .eq('requester_id', actorId)
      .eq('addressee_id', (await supabase.auth.getUser()).data.user?.id)
      .eq('status', 'pending')
      .maybeSingle();
    if (req) {
      await supabase.rpc('respond_to_friend_request', {
        p_request_id: req.id,
        p_accept: true,
      });
    }
    await markOneRead(notifId);
    router.refresh();
    setBusy(false);
  };

  const declineFriend = async (actorId: string, notifId: number) => {
    setBusy(true);
    const { data: req } = await supabase
      .from('friendships')
      .select('id')
      .eq('requester_id', actorId)
      .eq('addressee_id', (await supabase.auth.getUser()).data.user?.id)
      .eq('status', 'pending')
      .maybeSingle();
    if (req) {
      await supabase.rpc('respond_to_friend_request', {
        p_request_id: req.id,
        p_accept: false,
      });
    }
    await markOneRead(notifId);
    router.refresh();
    setBusy(false);
  };

  return (
    <>
      <header className="admin-head">
        <div>
          <h1>Уведомления</h1>
          <p className="admin-head-sub">
            {unreadCount > 0
              ? `Непрочитанных: ${unreadCount}`
              : 'Все прочитано'}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={markAllRead}
            disabled={busy}
          >
            Прочитать всё
          </button>
        )}
      </header>

      {/* Киллер-фича #2: фильтры по категориям */}
      <nav className="bookmark-tabs">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === 'all' ? '/notifications' : `/notifications?filter=${f.key}`}
            className={`bookmark-tab${filter === f.key ? ' active' : ''}`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <div className="empty-state">
          <p>В этой категории ничего нет.</p>
          <Link href="/notifications" className="btn btn-ghost">
            Показать все
          </Link>
        </div>
      ) : (
        <div className="notif-list">
          {items.map((n) => {
            const initial =
              (n.actor_name ?? '?').trim().charAt(0).toUpperCase() || '?';
            const isFriendRequest = n.type === 'friend_request';
            return (
              <div
                key={n.id}
                className={`notif-row${!n.is_read ? ' notif-row--unread' : ''}`}
              >
                <div className="notif-icon-wrap">
                  {n.actor_avatar ? (
                    <img src={n.actor_avatar} alt="" className="notif-avatar" />
                  ) : n.actor_name ? (
                    <div className="notif-avatar notif-avatar--init">{initial}</div>
                  ) : (
                    <div className="notif-icon-only">{iconFor(n.type)}</div>
                  )}
                  <span className="notif-icon-badge" aria-hidden="true">
                    {iconFor(n.type)}
                  </span>
                </div>

                <div className="notif-body">
                  <div className="notif-text">
                    {n.text}
                    {/* Киллер-фича #1: группировка "и ещё N" */}
                    {n.group_count > 1 && (
                      <span className="notif-group">
                        {' '}и ещё {n.group_count - 1}
                      </span>
                    )}
                  </div>
                  <div className="notif-time">{timeAgo(n.created_at)}</div>

                  {/* Киллер #3: action buttons */}
                  {isFriendRequest && n.actor_id && (
                    <div className="notif-actions">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => acceptFriend(n.actor_id!, n.id)}
                        disabled={busy}
                      >
                        Принять
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => declineFriend(n.actor_id!, n.id)}
                        disabled={busy}
                      >
                        Отклонить
                      </button>
                    </div>
                  )}

                  {!isFriendRequest && n.target_url && (
                    <Link
                      href={n.target_url}
                      className="notif-link"
                      onClick={() => markOneRead(n.id)}
                    >
                      Открыть →
                    </Link>
                  )}
                </div>

                {!n.is_read && (
                  <button
                    type="button"
                    className="notif-dismiss"
                    onClick={() => markOneRead(n.id)}
                    title="Пометить прочитанным"
                    aria-label="Пометить прочитанным"
                  >
                    ✓
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
