'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { timeAgo } from '@/lib/format';

interface Comment {
  id: number;
  user_id: string | null;
  novel_id: number;
  chapter_number: number;
  text: string;
  like_count: number;
  reply_to: number | null;
  user_name: string | null;
  user_avatar_url: string | null;
  user_avatar: string | null;
  is_vip: boolean | null;
  created_at: string;
  user_has_liked?: boolean;
}

interface Props {
  novelId: number;
  chapterNumber: number;
}

// Киллер-фича #3: спойлер-синтаксис Reddit-style
// >!скрытый текст!<  →  при клике «Показать»
function renderWithSpoilers(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = />!([\s\S]+?)!</g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <Spoiler key={`sp${i++}`}>{m[1]}</Spoiler>
    );
    last = start + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length > 0 ? parts : [text];
}

function Spoiler({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      className={`comment-spoiler${revealed ? ' revealed' : ''}`}
      onClick={() => setRevealed(true)}
      title={revealed ? '' : 'Нажми, чтобы показать'}
    >
      {revealed ? children : '•••••••• спойлер ••••••••'}
    </span>
  );
}

export default function CommentsSection({ novelId, chapterNumber }: Props) {
  const supabase = createClient();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);

  const [newText, setNewText] = useState('');
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadComments = useCallback(async () => {
    const { data, error } = await supabase
      .from('comments')
      .select('id, user_id, novel_id, chapter_number, text, like_count, reply_to, user_name, user_avatar_url, user_avatar, is_vip, created_at')
      .eq('novel_id', novelId)
      .eq('chapter_number', chapterNumber)
      .order('created_at', { ascending: true });

    if (error || !data) {
      setLoading(false);
      return;
    }

    let myLikedIds: Set<number> = new Set();
    if (userId && data.length > 0) {
      const { data: likes } = await supabase
        .from('comment_likes')
        .select('comment_id')
        .eq('user_id', userId)
        .in('comment_id', data.map((c) => c.id));
      myLikedIds = new Set((likes ?? []).map((l) => l.comment_id));
    }

    setComments(
      data.map((c) => ({
        ...c,
        user_has_liked: myLikedIds.has(c.id),
      })) as Comment[]
    );
    setLoading(false);
  }, [supabase, novelId, chapterNumber, userId]);

  // Инициализация: берём пользователя и грузим комменты
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (user) {
        setUserId(user.id);
        const { data: profile } = await supabase
          .from('profiles')
          .select('user_name')
          .eq('id', user.id)
          .maybeSingle();
        setUserName(profile?.user_name ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  // Отправка нового комментария (верхнего уровня или ответ)
  const handleSubmit = async (text: string, parentId: number | null) => {
    if (!userId) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    setSubmitting(true);

    const { error } = await supabase.from('comments').insert({
      novel_id: novelId,
      chapter_number: chapterNumber,
      user_id: userId,
      user_name: userName || 'Читатель',
      text: trimmed,
      reply_to: parentId,
    });
    setSubmitting(false);
    if (error) {
      alert(`Ошибка отправки: ${error.message}`);
      return;
    }
    if (parentId === null) setNewText('');
    else {
      setReplyText('');
      setReplyTo(null);
    }
    loadComments();
  };

  // Киллер-фича #1: лайки через comment_likes
  const toggleLike = async (comment: Comment) => {
    if (!userId) return;

    // Оптимистичный апдейт
    setComments((prev) =>
      prev.map((c) =>
        c.id === comment.id
          ? {
              ...c,
              user_has_liked: !c.user_has_liked,
              like_count: Math.max(0, (c.like_count ?? 0) + (c.user_has_liked ? -1 : 1)),
            }
          : c
      )
    );

    if (comment.user_has_liked) {
      await supabase
        .from('comment_likes')
        .delete()
        .eq('user_id', userId)
        .eq('comment_id', comment.id);
      // уменьшаем like_count руками
      await supabase
        .from('comments')
        .update({ like_count: Math.max(0, (comment.like_count ?? 0) - 1) })
        .eq('id', comment.id);
    } else {
      await supabase.from('comment_likes').insert({
        user_id: userId,
        comment_id: comment.id,
      });
      await supabase
        .from('comments')
        .update({ like_count: (comment.like_count ?? 0) + 1 })
        .eq('id', comment.id);
    }
  };

  // Киллер-фича #2: вложенные ответы (reply_to)
  const topLevel = comments.filter((c) => c.reply_to === null);
  const repliesByParent = new Map<number, Comment[]>();
  for (const c of comments) {
    if (c.reply_to) {
      const arr = repliesByParent.get(c.reply_to) ?? [];
      arr.push(c);
      repliesByParent.set(c.reply_to, arr);
    }
  }

  const renderOne = (c: Comment, depth: number) => {
    const replies = repliesByParent.get(c.id) ?? [];
    const initial = (c.user_name ?? '?').charAt(0).toUpperCase();
    const avatar = c.user_avatar_url || c.user_avatar;

    return (
      <div
        key={c.id}
        className={`comment-item${depth > 0 ? ' comment-item--reply' : ''}`}
      >
        <div className="comment-avatar">
          {avatar ? <img src={avatar} alt="" /> : <span>{initial}</span>}
        </div>
        <div className="comment-body">
          <div className="comment-head">
            <span className="comment-author">
              {c.user_name ?? 'Читатель'}
              {c.is_vip && <span className="comment-vip" title="Подписчик">★</span>}
            </span>
            <span className="comment-time">{timeAgo(c.created_at)}</span>
          </div>
          <div className="comment-text">{renderWithSpoilers(c.text)}</div>
          <div className="comment-actions">
            <button
              type="button"
              className={`comment-like${c.user_has_liked ? ' liked' : ''}`}
              onClick={() => toggleLike(c)}
              disabled={!userId}
              aria-label="Лайк"
            >
              {c.user_has_liked ? '❤' : '♡'} {c.like_count ?? 0}
            </button>
            {userId && depth === 0 && (
              <button
                type="button"
                className="comment-reply-btn"
                onClick={() => {
                  setReplyTo(replyTo === c.id ? null : c.id);
                  setReplyText('');
                }}
              >
                {replyTo === c.id ? 'Отмена' : 'Ответить'}
              </button>
            )}
          </div>

          {replyTo === c.id && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSubmit(replyText, c.id);
              }}
              className="comment-reply-form"
            >
              <textarea
                className="form-textarea"
                rows={2}
                placeholder="Напиши ответ… (для спойлера: >!скрыто!<)"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                maxLength={2000}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting || !replyText.trim()}
              >
                Ответить
              </button>
            </form>
          )}

          {replies.length > 0 && (
            <div className="comment-replies">
              {replies.map((r) => renderOne(r, depth + 1))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <section className="comments-section">
      <h3>Обсуждение {comments.length > 0 && <small>({comments.length})</small>}</h3>

      {userId ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit(newText, null);
          }}
          className="comment-form"
        >
          <textarea
            className="form-textarea"
            rows={3}
            placeholder="Напиши что-нибудь о главе… Спрятать спойлер: >!текст!<"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            maxLength={2000}
          />
          <div className="comment-form-foot">
            <div className="comment-form-hint">
              <code>&gt;!скрытый текст!&lt;</code> — спрячется под спойлер
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || !newText.trim()}
            >
              {submitting ? 'Отправляем…' : 'Отправить'}
            </button>
          </div>
        </form>
      ) : (
        <div className="empty-state" style={{ padding: 20 }}>
          <Link href="/login" className="more">Войти</Link>, чтобы комментировать.
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--ink-mute)' }}>Загружаем комментарии…</p>
      ) : topLevel.length === 0 ? (
        <p style={{ color: 'var(--ink-mute)' }}>
          Пока никто не оставил отзыв. Будь первым.
        </p>
      ) : (
        <div className="comments-list">
          {topLevel.map((c) => renderOne(c, 0))}
        </div>
      )}
    </section>
  );
}
