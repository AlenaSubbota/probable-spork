import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import FriendActions from './FriendActions';
import { detectReadingNow } from '@/lib/social';

export const metadata = {
  title: 'Друзья — Chaptify',
};

export default async function FriendsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Загружаем все дружеские связи
  let rows: Array<{
    id: number;
    requester_id: string;
    addressee_id: string;
    status: string;
    created_at: string;
  }> = [];
  try {
    const { data } = await supabase
      .from('friendships')
      .select('id, requester_id, addressee_id, status, created_at')
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
      .in('status', ['pending', 'accepted']);
    rows = data ?? [];
  } catch {
    // миграция 006 не накачена
  }

  const otherIds = new Set<string>();
  for (const r of rows) {
    otherIds.add(r.requester_id === user.id ? r.addressee_id : r.requester_id);
  }

  // Подтягиваем профили
  let profiles: Array<{
    id: string;
    user_name: string | null;
    translator_display_name: string | null;
    translator_avatar_url: string | null;
    last_read: Record<string, { novelId: number; chapterId: number; timestamp: string }> | null;
  }> = [];
  if (otherIds.size > 0) {
    const { data } = await supabase
      .from('profiles')
      .select('id, user_name, translator_display_name, translator_avatar_url, last_read')
      .in('id', Array.from(otherIds));
    profiles = (data ?? []) as typeof profiles;
  }
  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  const friends: typeof rows = [];
  const incoming: typeof rows = [];
  const outgoing: typeof rows = [];
  for (const r of rows) {
    if (r.status === 'accepted') friends.push(r);
    else if (r.status === 'pending' && r.addressee_id === user.id) incoming.push(r);
    else if (r.status === 'pending' && r.requester_id === user.id) outgoing.push(r);
  }

  const renderRow = (
    r: typeof rows[0],
    kind: 'friend' | 'incoming' | 'outgoing'
  ) => {
    const otherId = r.requester_id === user.id ? r.addressee_id : r.requester_id;
    const other = profileMap.get(otherId);
    if (!other) return null;
    const name =
      other.translator_display_name || other.user_name || 'Читатель';
    const initial = name.trim().charAt(0).toUpperCase() || '?';
    const reading = detectReadingNow(other.last_read ?? null);

    return (
      <div key={r.id} className="friend-row">
        <Link href={`/u/${other.id}`} className="friend-avatar">
          {other.translator_avatar_url ? (
            <img src={other.translator_avatar_url} alt="" />
          ) : (
            <span>{initial}</span>
          )}
          {reading.state === 'reading' && (
            <span className="friend-online-dot" title="Читает сейчас" />
          )}
        </Link>
        <div className="friend-body">
          <Link href={`/u/${other.id}`} className="friend-name">
            {name}
          </Link>
          {reading.state === 'reading' && (
            <div className="friend-status friend-status--online">
              читает сейчас
            </div>
          )}
          {reading.state === 'recent' && reading.timestamp && (
            <div className="friend-status">
              был{other.user_name ? 'а' : ''} недавно
            </div>
          )}
          {reading.state === 'away' && other.user_name && (
            <div className="friend-status friend-status--dim">@{other.user_name}</div>
          )}
        </div>
        <FriendActions
          otherId={otherId}
          requestId={r.id}
          kind={kind}
        />
      </div>
    );
  };

  return (
    <main className="container section">
      <header className="admin-head">
        <div>
          <h1>Друзья</h1>
          <p className="admin-head-sub">
            Твой круг — тут же запросы и короткий переход к чату.
          </p>
        </div>
        <Link href="/messages" className="btn btn-ghost">
          ✉ Сообщения
        </Link>
      </header>

      {/* Входящие заявки */}
      {incoming.length > 0 && (
        <section className="friends-section">
          <h2>
            Новые запросы{' '}
            <span className="friends-count">{incoming.length}</span>
          </h2>
          <div className="friends-list">
            {incoming.map((r) => renderRow(r, 'incoming'))}
          </div>
        </section>
      )}

      {/* Мои друзья */}
      <section className="friends-section">
        <h2>
          Мои друзья{' '}
          <span className="friends-count">{friends.length}</span>
        </h2>
        {friends.length === 0 ? (
          <div className="empty-state">
            <p>Пока никого нет. Открой страницу любого читателя и нажми «+ В друзья».</p>
            <Link href="/catalog" className="btn btn-ghost">
              К каталогу
            </Link>
          </div>
        ) : (
          <div className="friends-list">
            {friends.map((r) => renderRow(r, 'friend'))}
          </div>
        )}
      </section>

      {/* Исходящие заявки */}
      {outgoing.length > 0 && (
        <section className="friends-section">
          <h2>
            Ожидают ответа{' '}
            <span className="friends-count">{outgoing.length}</span>
          </h2>
          <div className="friends-list">
            {outgoing.map((r) => renderRow(r, 'outgoing'))}
          </div>
        </section>
      )}
    </main>
  );
}
