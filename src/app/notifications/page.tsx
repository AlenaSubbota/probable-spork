import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import NotificationsClient, { type Notification } from './NotificationsClient';

export const metadata = {
  title: 'Уведомления — Chaptify',
};

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const params = await searchParams;
  const filter = params.filter ?? 'all';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  let notifications: Notification[] = [];
  try {
    const { data } = await supabase.rpc('list_notifications', {
      p_limit: 80,
      p_only_unread: filter === 'unread',
    });
    if (Array.isArray(data)) notifications = data as Notification[];
  } catch {
    // миграция 007 не накачена
  }

  // Фильтруем по типу, если выбрана конкретная категория
  if (filter !== 'all' && filter !== 'unread') {
    notifications = notifications.filter((n) => categoryOf(n.type) === filter);
  }

  return (
    <main className="container section">
      <div className="admin-breadcrumbs">
        <Link href="/">Главная</Link>
        <span>/</span>
        <span>Уведомления</span>
      </div>
      <NotificationsClient
        initial={notifications}
        filter={filter}
      />
    </main>
  );
}

function categoryOf(type: string): string {
  if (type === 'message') return 'messages';
  if (type === 'friend_request' || type === 'friend_accepted') return 'friends';
  if (type === 'comment_reply' || type === 'comment_like') return 'comments';
  if (type === 'new_subscriber') return 'business';
  if (type === 'new_chapter') return 'chapters';
  return 'other';
}
