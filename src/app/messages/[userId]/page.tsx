import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import MessageThread from './MessageThread';
import { detectReadingNow } from '@/lib/social';

interface PageProps {
  params: Promise<{ userId: string }>;
}

export default async function ChatPage({ params }: PageProps) {
  const { userId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  if (user.id === userId) redirect('/messages');

  // Проверяем дружбу
  let isFriend = false;
  try {
    const { data } = await supabase.rpc('get_friendship_status', {
      p_other: userId,
    });
    isFriend = data === 'friends';
  } catch {
    isFriend = false;
  }

  // Собеседник
  const { data: otherRaw } = await supabase
    .from('profiles')
    .select('id, user_name, translator_display_name, translator_avatar_url, last_read')
    .eq('id', userId)
    .maybeSingle();
  if (!otherRaw) notFound();

  const other = otherRaw as {
    id: string;
    user_name: string | null;
    translator_display_name: string | null;
    translator_avatar_url: string | null;
    last_read: Record<string, { novelId: number; chapterId: number; timestamp: string }> | null;
  };

  const name = other.translator_display_name || other.user_name || 'Читатель';
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const reading = detectReadingNow(other.last_read);

  // Помечаем прочитанными
  if (isFriend) {
    try {
      await supabase.rpc('mark_dm_read', { p_other: userId });
    } catch {}
  }

  // Загружаем историю
  let initialMessages: Array<{
    id: number;
    sender_id: string;
    recipient_id: string;
    text: string;
    attached_novel_id: number | null;
    attached_chapter_number: number | null;
    created_at: string;
    read_at: string | null;
  }> = [];

  if (isFriend) {
    const { data } = await supabase
      .from('direct_messages')
      .select('id, sender_id, recipient_id, text, attached_novel_id, attached_chapter_number, created_at, read_at')
      .or(
        `and(sender_id.eq.${user.id},recipient_id.eq.${userId}),and(sender_id.eq.${userId},recipient_id.eq.${user.id})`
      )
      .order('created_at', { ascending: true })
      .limit(500);
    initialMessages = (data ?? []) as typeof initialMessages;
  }

  // Подтягиваем превью для attached_novels (для киллер-фичи «поделиться главой»)
  const attachedNovelIds = Array.from(
    new Set(
      initialMessages
        .map((m) => m.attached_novel_id)
        .filter((x): x is number => !!x)
    )
  );
  let novelPreviewMap: Record<number, { title: string; firebase_id: string; cover_url: string | null }> = {};
  if (attachedNovelIds.length > 0) {
    const { data } = await supabase
      .from('novels')
      .select('id, title, firebase_id, cover_url')
      .in('id', attachedNovelIds);
    for (const n of data ?? []) {
      novelPreviewMap[n.id] = {
        title: n.title,
        firebase_id: n.firebase_id,
        cover_url: n.cover_url,
      };
    }
  }

  return (
    <main className="container section chat-page">
      <div className="chat-header">
        <Link href="/messages" className="btn btn-ghost" style={{ height: 32 }}>
          ← Все чаты
        </Link>
        <Link href={`/u/${other.id}`} className="chat-header-user">
          <div className="friend-avatar friend-avatar--sm">
            {other.translator_avatar_url ? (
              <img src={other.translator_avatar_url} alt="" />
            ) : (
              <span>{initial}</span>
            )}
            {reading.state === 'reading' && (
              <span className="friend-online-dot" title="Читает сейчас" />
            )}
          </div>
          <div>
            <div className="chat-header-name">{name}</div>
            <div className="chat-header-status">
              {reading.state === 'reading'
                ? 'читает сейчас'
                : reading.state === 'recent'
                ? 'недавно был активен'
                : 'офлайн'}
            </div>
          </div>
        </Link>
      </div>

      {!isFriend ? (
        <div className="empty-state">
          <p>
            С этим пользователем вы не дружите. Чтобы писать сообщения,
            сначала <Link href={`/u/${userId}`} className="more">добавьте друг друга в друзья</Link>.
          </p>
        </div>
      ) : (
        <MessageThread
          myId={user.id}
          otherId={userId}
          initial={initialMessages}
          novelPreviewMap={novelPreviewMap}
        />
      )}
    </main>
  );
}
