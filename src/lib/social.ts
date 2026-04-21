// Статусы дружбы, которые возвращает RPC get_friendship_status
export type FriendshipStatus =
  | 'none'
  | 'pending_outgoing'   // я отправил, ждём ответа
  | 'pending_incoming'   // мне отправили, надо принять/отклонить
  | 'friends'            // дружим
  | 'declined'
  | 'blocked';

// Статусы «онлайн» / «читает сейчас»
export type ReadingNowState =
  | { state: 'reading'; novelTitle: string; chapterNumber: number; novelFbId: string }
  | { state: 'recent' }   // был активен <24ч назад
  | { state: 'away' };    // всё остальное

// Определяем состояние активности по timestamp из last_read (самый свежий)
export function detectReadingNow(
  lastRead: Record<string, { novelId: number; chapterId: number; timestamp: string }> | null
): { state: 'reading' | 'recent' | 'away'; timestamp: string | null; entry: { novelId: number; chapterId: number; timestamp: string } | null } {
  if (!lastRead) return { state: 'away', timestamp: null, entry: null };
  const entries = Object.values(lastRead);
  if (entries.length === 0) return { state: 'away', timestamp: null, entry: null };
  const latest = entries.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )[0];
  const ageMin = (Date.now() - new Date(latest.timestamp).getTime()) / 60_000;
  if (ageMin <= 60) return { state: 'reading', timestamp: latest.timestamp, entry: latest };
  if (ageMin <= 24 * 60) return { state: 'recent', timestamp: latest.timestamp, entry: latest };
  return { state: 'away', timestamp: latest.timestamp, entry: latest };
}
