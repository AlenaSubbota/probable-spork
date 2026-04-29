import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { timeAgo } from '@/lib/format';
import { detectReadingNow } from '@/lib/social';

export const metadata = {
  title: 'Сообщения — Chaptify',
};

export default async function MessagesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  let conversations: Array<{
    other_id: string;
    last_text: string;
    last_at: string;
    last_from_me: boolean;
    unread_count: number;
  }> = [];
  try {
    const { data } = await supabase.rpc('list_conversations');
    if (Array.isArray(data)) conversations = data;
  } catch {
    // RPC ещё не существует
  }

  // Подтягиваем профили собеседников
  const otherIds = conversations.map((c) => c.other_id);
  let profiles: Array<{
    id: string;
    user_name: string | null;
    translator_display_name: string | null;
    translator_avatar_url: string | null;
    last_read: Record<string, { novelId: number; chapterId: number; timestamp: string }> | null;
  }> = [];
  if (otherIds.length > 0) {
    const { data } = await supabase
      .from('profiles')
      .select('id, user_name, translator_display_name, translator_avatar_url, last_read')
      .in('id', otherIds);
    profiles = (data ?? []) as typeof profiles;
  }
  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  return (
    <main className="container section">
      <div className="admin-breadcrumbs">
        <Link href="/">Главная</Link>
        <span>/</span>
        <span>Сообщения</span>
      </div>
      <header className="admin-head">
        <div>
          <h1>Сообщения</h1>
          <p className="admin-head-sub">
            Личные чаты с друзьями.
          </p>
        </div>
        <Link href="/friends" className="btn btn-ghost">
          Друзья
        </Link>
      </header>

      {conversations.length === 0 ? (
        <div className="empty-state">
          <p>Нет активных чатов. Зайди в друзья и начни разговор.</p>
          <Link href="/friends" className="btn btn-primary">
            К друзьям
          </Link>
        </div>
      ) : (
        <div className="chat-list">
          {conversations.map((c) => {
            const other = profileMap.get(c.other_id);
            const name =
              other?.translator_display_name || other?.user_name || 'Читатель';
            const initial = name.trim().charAt(0).toUpperCase() || '?';
            const reading = detectReadingNow(other?.last_read ?? null);
            return (
              <Link
                key={c.other_id}
                href={`/messages/${c.other_id}`}
                className={`chat-row${c.unread_count > 0 ? ' chat-row--unread' : ''}`}
              >
                <div className="friend-avatar">
                  {other?.translator_avatar_url ? (
                    <img src={other.translator_avatar_url} alt="" />
                  ) : (
                    <span>{initial}</span>
                  )}
                  {reading.state === 'reading' && (
                    <span className="friend-online-dot" title="Читает сейчас" />
                  )}
                </div>
                <div className="chat-body">
                  <div className="chat-head">
                    <span className="chat-name">{name}</span>
                    <span className="chat-time">{timeAgo(c.last_at)}</span>
                  </div>
                  <div className="chat-preview">
                    {c.last_from_me && <span className="chat-from-me">ты: </span>}
                    {c.last_text}
                  </div>
                </div>
                {c.unread_count > 0 && (
                  <span className="chat-badge">{c.unread_count}</span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
