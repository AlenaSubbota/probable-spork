import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import UserAvatar from '@/components/UserAvatar';
import FriendshipButton from '@/components/social/FriendshipButton';
import { detectReadingNow, type FriendshipStatus } from '@/lib/social';
import { timeAgo } from '@/lib/format';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PublicUserProfile({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user: viewer } } = await supabase.auth.getUser();

  // Ищем профиль: сперва по id, иначе по user_name
  const { data: byId } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  const { data: byName } = byId
    ? { data: byId }
    : await supabase.from('profiles').select('*').eq('user_name', id).maybeSingle();

  const profile = byId ?? byName;
  if (!profile) notFound();

  const p = profile as {
    id: string;
    user_name: string | null;
    role?: string;
    is_admin?: boolean;
    last_read?: Record<string, { novelId: number; chapterId: number; timestamp: string }> | null;
    bookmarks?: unknown;
    translator_slug?: string | null;
    translator_display_name?: string | null;
    translator_avatar_url?: string | null;
    avatar_url?: string | null;
    settings?: { show_reading_publicly?: boolean } | null;
  };

  const isSelf = viewer?.id === p.id;
  const displayName = p.translator_display_name || p.user_name || 'Читатель';
  const isAdmin = p.is_admin === true || p.role === 'admin';
  const isTranslator = isAdmin || p.role === 'translator';

  // Приватность: если выключено — скрываем last_read и статы от чужих.
  // Владелец своего профиля и админ видят всегда.
  const showReading =
    isSelf || isAdmin || p.settings?.show_reading_publicly !== false;

  // Friendship status
  let friendshipStatus: FriendshipStatus = 'none';
  if (viewer && !isSelf) {
    try {
      const { data } = await supabase.rpc('get_friendship_status', {
        p_other: p.id,
      });
      if (typeof data === 'string') {
        friendshipStatus = data as FriendshipStatus;
      }
    } catch {
      // RPC ещё не накачена
    }
  }

  // --- Киллер-фича #1: общие новеллы (требует доступ к last_read обоих) ---
  let sharedReadsCount = 0;
  let sharedTitles: string[] = [];
  if (viewer && !isSelf && p.last_read && showReading) {
    const { data: viewerProfile } = await supabase
      .from('profiles')
      .select('last_read, bookmarks')
      .eq('id', viewer.id)
      .maybeSingle();
    const myReads = Object.keys(
      (viewerProfile as { last_read?: Record<string, unknown> } | null)?.last_read ?? {}
    );
    const theirReads = Object.keys(p.last_read);
    const sharedIds = myReads.filter((id) => theirReads.includes(id));
    sharedReadsCount = sharedIds.length;

    if (sharedIds.length > 0) {
      const { data: novels } = await supabase
        .from('novels')
        .select('title')
        .in(
          'id',
          sharedIds.map((s) => parseInt(s, 10)).filter((n) => !isNaN(n)).slice(0, 6)
        );
      sharedTitles = (novels ?? []).map((n) => n.title);
    }
  }

  // --- Читает сейчас / когда был активен (только если пользователь разрешил) ---
  const readingNow = showReading
    ? detectReadingNow(p.last_read ?? null)
    : { state: 'away' as const, timestamp: null, entry: null };
  let readingNovelInfo: { title: string; firebase_id: string } | null = null;
  if (readingNow.state === 'reading' && readingNow.entry) {
    const { data: n } = await supabase
      .from('novels')
      .select('title, firebase_id')
      .eq('id', readingNow.entry.novelId)
      .maybeSingle();
    if (n) readingNovelInfo = n as { title: string; firebase_id: string };
  }

  // Общая статистика (только если разрешено показывать)
  const totalReads = showReading && p.last_read ? Object.keys(p.last_read).length : 0;
  const bookmarksCount = showReading
    ? Array.isArray(p.bookmarks)
      ? (p.bookmarks as unknown[]).length
      : p.bookmarks && typeof p.bookmarks === 'object'
      ? Object.keys(p.bookmarks as Record<string, unknown>).length
      : 0
    : 0;

  return (
    <main className="container section">
      <div className="admin-breadcrumbs">
        <Link href="/">Главная</Link>
        <span>/</span>
        <span>Профиль читателя</span>
      </div>
      <div className="user-profile-hero">
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <UserAvatar
            avatarUrl={p.translator_avatar_url ?? p.avatar_url}
            name={displayName}
            size={100}
          />
          {readingNow.state === 'reading' && (
            <span className="user-profile-online-dot" title="Читает прямо сейчас" />
          )}
        </div>

        <div className="user-profile-body">
          <h1>{displayName}</h1>
          <div className="user-profile-meta">
            {p.user_name && <span>@{p.user_name}</span>}
            {isAdmin && <span className="note">Админ</span>}
            {!isAdmin && p.role === 'translator' && <span className="note">Переводчик</span>}
          </div>

          {/* Читает сейчас / был активен */}
          {readingNow.state === 'reading' && readingNovelInfo && (
            <div className="user-profile-reading">
              <span className="user-profile-reading-dot" aria-hidden="true" />
              Читает{' '}
              <Link
                href={`/novel/${readingNovelInfo.firebase_id}`}
                className="user-profile-reading-link"
              >
                «{readingNovelInfo.title}»
              </Link>
            </div>
          )}
          {readingNow.state === 'recent' && readingNow.timestamp && (
            <div className="user-profile-activity">
              Был{p.user_name ? 'а' : ''} активен {timeAgo(readingNow.timestamp)}
            </div>
          )}

          <div className="user-profile-stats">
            <div>
              <div className="user-profile-stat-val">{totalReads}</div>
              <div className="user-profile-stat-lbl">открытых новелл</div>
            </div>
            <div>
              <div className="user-profile-stat-val">{bookmarksCount}</div>
              <div className="user-profile-stat-lbl">в закладках</div>
            </div>
          </div>
        </div>

        <div className="user-profile-actions">
          {isSelf ? (
            <Link href="/profile" className="btn btn-ghost">
              Твой профиль →
            </Link>
          ) : viewer ? (
            <FriendshipButton
              otherUserId={p.id}
              initialStatus={friendshipStatus}
            />
          ) : (
            <Link href="/login" className="btn btn-primary">
              Войти, чтобы добавить в друзья
            </Link>
          )}
          {isTranslator && p.translator_slug && (
            <Link href={`/t/${p.translator_slug}`} className="btn btn-ghost">
              Страница переводчика →
            </Link>
          )}
        </div>
      </div>

      {/* Киллер-фича #1: общие новеллы */}
      {!isSelf && viewer && sharedReadsCount > 0 && (
        <div className="handshake-card">
          <div className="handshake-icon" aria-hidden="true">🤝</div>
          <div>
            <strong>
              У вас {sharedReadsCount}{' '}
              {plural(sharedReadsCount, 'общая новелла', 'общие новеллы', 'общих новелл')}
            </strong>
            {sharedTitles.length > 0 && (
              <div className="handshake-titles">{sharedTitles.slice(0, 3).join(' · ')}</div>
            )}
          </div>
        </div>
      )}

      {!isSelf && viewer && sharedReadsCount === 0 && friendshipStatus === 'friends' && (
        <div className="handshake-card dim">
          <div className="handshake-icon" aria-hidden="true">🌱</div>
          <div>Пока нет совпадений — ты можешь первой порекомендовать что-нибудь.</div>
        </div>
      )}
    </main>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
