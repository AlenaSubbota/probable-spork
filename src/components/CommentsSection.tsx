'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { timeAgo } from '@/lib/format';
import { commentToHtml } from '@/lib/commentFormat';
import CommentToolbar from './CommentToolbar';
import ReportButton from './ReportButton';
import { useToasts, ToastStack } from '@/components/ui/Toast';

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
  /** Опциональный блок, который рендерится в самом верху секции
      обсуждения, прямо под заголовком. Использовался для «♥ спасибо
      переводчику» — теперь это естественный жест после прочтения, и
      ему место рядом с комментариями, а не отдельной секцией. */
  topSlot?: React.ReactNode;
}

export default function CommentsSection({ novelId, chapterNumber, topSlot }: Props) {
  const supabase = createClient();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const { items: toasts, push, dismiss } = useToasts();

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
      push('error', `Ошибка отправки: ${error.message}`);
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
    const wasLiked = !!comment.user_has_liked;
    setComments((prev) =>
      prev.map((c) =>
        c.id === comment.id
          ? {
              ...c,
              user_has_liked: !wasLiked,
              like_count: Math.max(0, (c.like_count ?? 0) + (wasLiked ? -1 : 1)),
            }
          : c
      )
    );

    // RPC из миграции 030: одним вызовом toggle + пересчёт like_count.
    // Клиент не может UPDATE чужой коммент после RLS из миграции 029,
    // поэтому всё через security-definer RPC.
    const { data, error } = await supabase.rpc('toggle_comment_like', {
      p_comment_id: comment.id,
    });
    if (error) {
      // Откатываем оптимистичный апдейт
      setComments((prev) =>
        prev.map((c) =>
          c.id === comment.id
            ? { ...c, user_has_liked: wasLiked, like_count: comment.like_count }
            : c
        )
      );
      return;
    }
    const res = (data ?? {}) as { ok?: boolean; liked?: boolean; count?: number };
    if (res.ok) {
      // Синхронизируем с реальным count из БД
      setComments((prev) =>
        prev.map((c) =>
          c.id === comment.id
            ? {
                ...c,
                user_has_liked: !!res.liked,
                like_count: res.count ?? c.like_count,
              }
            : c
        )
      );
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
      push('error', `Не удалось сохранить: ${error.message}`);
      return;
    }
    const res = (data ?? {}) as { ok?: boolean; error?: string };
    if (!res.ok) {
      push('error', `Не удалось сохранить: ${res.error ?? 'unknown'}`);
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
      push('error', `Ошибка: ${error.message}`);
      return;
    }
    const res = (data ?? {}) as { ok?: boolean; error?: string };
    if (!res.ok) {
      push('error', `Не удалось: ${res.error ?? 'unknown'}`);
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

    // Визуальную глубину кэпим на 3 уровнях — дальше ветка плоская,
    // чтобы на мобиле treading не съедал ширину текста.
    const visualDepth = Math.min(depth, 3);
    return (
      <div
        key={c.id}
        data-depth={visualDepth}
        className={`comment-item${depth > 0 ? ' comment-item--reply' : ''}${deleted ? ' comment-item--deleted' : ''}`}
      >
        <div className="comment-avatar" aria-hidden="true">
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
              <CommentToolbar
                value={editingText}
                onChange={setEditingText}
                rows={3}
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
              {userId && (
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
              {/* Жалоба на чужой комментарий. Свой комментарий —
                  ему тоже без жалобы (можно просто отредактировать
                  или удалить, есть кнопки). Жалобы с админа на админа
                  тоже скрываем — модерируют через прямое удаление. */}
              {!isMine && !isAdmin && (
                <ReportButton
                  targetType="comment"
                  targetId={c.id}
                  isLoggedIn={!!userId}
                  compact
                />
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
              <CommentToolbar
                value={replyText}
                onChange={setReplyText}
                rows={2}
                maxLength={2000}
                placeholder={`Ответ для ${c.user_name ?? 'читателя'}…`}
                autoFocus
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting || !replyText.trim()}
                style={{ marginTop: 6 }}
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

      {topSlot && (
        <div className="comments-section-top-slot">{topSlot}</div>
      )}

      {userId ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit(newText, null);
          }}
          className="comment-form"
        >
          <CommentToolbar
            value={newText}
            onChange={setNewText}
            rows={3}
            maxLength={2000}
            placeholder="Напиши что-нибудь о главе… Выдели текст и нажми кнопку форматирования."
          />
          <div className="comment-form-foot" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
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
        <div className="empty-state" style={{ padding: '20px 20px 24px', marginBottom: 18 }}>
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

      <ToastStack items={toasts} onDismiss={dismiss} />
    </section>
  );
}
