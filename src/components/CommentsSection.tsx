'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { timeAgo } from '@/lib/format';
import { commentToHtml } from '@/lib/commentFormat';

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
  deleted_at: string | null;
  edited_at: string | null;
  user_has_liked?: boolean;
}

interface Props {
  novelId: number;
  chapterNumber: number;
}

export default function CommentsSection({ novelId, chapterNumber }: Props) {
  const supabase = createClient();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [newText, setNewText] = useState('');
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');

  const loadComments = useCallback(async () => {
    const { data, error } = await supabase
      .from('comments')
      .select('id, user_id, novel_id, chapter_number, text, like_count, reply_to, user_name, user_avatar_url, user_avatar, is_vip, created_at, deleted_at, edited_at')
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

  // Инициализация: берём пользователя, имя и роль
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (user) {
        setUserId(user.id);
        const { data: profile } = await supabase
          .from('profiles')
          .select('user_name, role, is_admin')
          .eq('id', user.id)
          .maybeSingle();
        const p = (profile ?? {}) as { user_name?: string | null; role?: string; is_admin?: boolean };
        setUserName(p.user_name ?? null);
        setIsAdmin(p.is_admin === true || p.role === 'admin');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

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

  const startEdit = (c: Comment) => {
    setEditingId(c.id);
    setEditingText(c.text);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText('');
  };

  const saveEdit = async (id: number) => {
    const trimmed = editingText.trim();
    if (!trimmed) return;
    const { data, error } = await supabase.rpc('edit_comment', {
      p_comment_id: id,
      p_text: trimmed,
    });
    if (error) {
      alert(`Не удалось сохранить: ${error.message}`);
      return;
    }
    const res = (data ?? {}) as { ok?: boolean; error?: string };
    if (!res.ok) {
      alert(`Не удалось сохранить: ${res.error ?? 'unknown'}`);
      return;
    }
    cancelEdit();
    loadComments();
  };

  const adminDelete = async (id: number) => {
    if (!confirm('Удалить этот комментарий?')) return;
    const { data, error } = await supabase.rpc('moderate_delete_comment', {
      p_comment_id: id,
    });
    if (error) {
      alert(`Ошибка: ${error.message}`);
      return;
    }
    const res = (data ?? {}) as { ok?: boolean; error?: string };
    if (!res.ok) {
      alert(`Не удалось: ${res.error ?? 'unknown'}`);
      return;
    }
    loadComments();
  };

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
    const deleted = !!c.deleted_at;
    const isMine = userId && c.user_id === userId;
    const canEdit = (isMine || isAdmin) && !deleted;
    const canDelete = isAdmin && !deleted;
    const isEditingThis = editingId === c.id;

    return (
      <div
        key={c.id}
        className={`comment-item${depth > 0 ? ' comment-item--reply' : ''}${deleted ? ' comment-item--deleted' : ''}`}
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
            <span className="comment-time">
              {timeAgo(c.created_at)}
              {c.edited_at && !deleted && (
                <span className="comment-edited" title={`Отредактировано ${timeAgo(c.edited_at)}`}>
                  {' '}· изменено
                </span>
              )}
            </span>
          </div>

          {deleted ? (
            <div className="comment-text comment-text--deleted">
              [комментарий удалён модератором]
            </div>
          ) : isEditingThis ? (
            <div className="comment-edit-form">
              <textarea
                className="form-textarea"
                rows={3}
                value={editingText}
                onChange={(e) => setEditingText(e.target.value)}
                maxLength={2000}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => saveEdit(c.id)}
                  disabled={!editingText.trim()}
                >
                  Сохранить
                </button>
                <button type="button" className="btn btn-ghost" onClick={cancelEdit}>
                  Отмена
                </button>
              </div>
            </div>
          ) : (
            <div
              className="comment-text"
              dangerouslySetInnerHTML={{ __html: commentToHtml(c.text) }}
            />
          )}

          {!deleted && !isEditingThis && (
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
              {canEdit && (
                <button
                  type="button"
                  className="comment-reply-btn"
                  onClick={() => startEdit(c)}
                  title="Редактировать"
                >
                  ✎ Изменить
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  className="comment-reply-btn comment-action-danger"
                  onClick={() => adminDelete(c.id)}
                  title="Удалить (админ)"
                >
                  🗑 Удалить
                </button>
              )}
            </div>
          )}

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
                placeholder="Напиши ответ… [b]жирный[/b], [spoiler]скрыто[/spoiler]"
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
            placeholder="Напиши что-нибудь о главе…"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            maxLength={2000}
          />
          <div className="comment-form-foot">
            <div className="comment-form-hint">
              <code>[b]жирный[/b]</code>{' '}
              <code>[i]курсив[/i]</code>{' '}
              <code>[spoiler]скрыто[/spoiler]</code>{' '}
              <code>[url]http…[/url]</code>
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
          Пока никто не оставил отзыв. Стань первым.
        </p>
      ) : (
        <div className="comments-list">
          {topLevel.map((c) => renderOne(c, 0))}
        </div>
      )}
    </section>
  );
}
