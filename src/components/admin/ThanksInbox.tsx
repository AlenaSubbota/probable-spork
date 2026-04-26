'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { useToasts, ToastStack } from '@/components/ui/Toast';
import {
  readerDisplayName,
  readerProfileHref,
  type ThanksWallRow,
} from '@/lib/thanks';
import { timeAgo } from '@/lib/format';

interface Props {
  initial: ThanksWallRow[];
}

// Inbox писем-благодарностей на дашборде переводчика. Показывает 5
// последних, развёртывается в полный список. Непрочитанные — сверху,
// с акцентом. Кнопка «прочитать все» — вызывает RPC mark_my_thanks_read.
export default function ThanksInbox({ initial }: Props) {
  const supabase = createClient();
  const { items: toasts, push, dismiss } = useToasts();
  const [items, setItems] = useState<ThanksWallRow[]>(initial);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  const unreadCount = useMemo(
    () => items.filter((t) => !t.is_read).length,
    [items]
  );

  const visible = expanded ? items : items.slice(0, 5);

  const markAllRead = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('mark_my_thanks_read', { p_id: null });
    setBusy(false);
    if (error) {
      push('error', error.message);
      return;
    }
    setItems((prev) =>
      prev.map((t) => ({ ...t, is_read: true, read_at: new Date().toISOString() }))
    );
    push('success', 'Все отмечены прочитанными.');
  };

  const togglePublic = async (id: number, nextPublic: boolean) => {
    const { error } = await supabase
      .from('translator_thanks')
      .update({ is_public: nextPublic })
      .eq('id', id);
    if (error) {
      push('error', error.message);
      return;
    }
    setItems((prev) =>
      prev.map((t) => (t.id === id ? { ...t, is_public: nextPublic } : t))
    );
    push('success', nextPublic ? 'В стене.' : 'Скрыто из стены.');
  };

  return (
    <section className="thanks-inbox">
      <div className="thanks-inbox-head">
        <div className="thanks-inbox-head-text">
          <h2 className="thanks-inbox-title">
            <span className="thanks-inbox-icon" aria-hidden="true">💌</span>
            Письма от читателей
            {unreadCount > 0 && (
              <span className="thanks-inbox-badge" aria-label={`${unreadCount} непрочитанных`}>
                {unreadCount}
              </span>
            )}
          </h2>
          <p className="thanks-inbox-sub">
            Эмоциональные письма «спасибо за главу X». Можно прятать
            конкретные из публичной стены — переключи «🌐 в стене».
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={markAllRead}
            disabled={busy}
          >
            ✓ Прочитать все
          </button>
        )}
      </div>

      <div className="thanks-inbox-list">
        {visible.map((t) => {
          const name = readerDisplayName(t);
          const initial = name.trim().charAt(0).toUpperCase() || '?';
          const href = readerProfileHref(t);
          return (
            <article
              key={t.id}
              className={`thanks-inbox-item${t.is_read ? '' : ' is-unread'}`}
            >
              <div className="thanks-inbox-item-avatar" aria-hidden="true">
                {t.reader_avatar_url ? (
                  <img src={t.reader_avatar_url} alt="" />
                ) : (
                  <span>{initial}</span>
                )}
              </div>
              <div className="thanks-inbox-item-body">
                <div className="thanks-inbox-item-meta">
                  {href ? (
                    <Link href={href} className="thanks-inbox-item-name">{name}</Link>
                  ) : (
                    <span className="thanks-inbox-item-name">{name}</span>
                  )}
                  {t.novel_title && t.novel_firebase_id && (
                    <>
                      <span className="thanks-inbox-item-sep" aria-hidden="true">·</span>
                      <Link
                        href={
                          t.chapter_number
                            ? `/novel/${t.novel_firebase_id}/${t.chapter_number}`
                            : `/novel/${t.novel_firebase_id}`
                        }
                        className="thanks-inbox-item-novel"
                      >
                        «{t.novel_title}»
                        {t.chapter_number ? `, гл. ${t.chapter_number}` : ''}
                      </Link>
                    </>
                  )}
                  <span className="thanks-inbox-item-sep" aria-hidden="true">·</span>
                  <time className="thanks-inbox-item-time">
                    {timeAgo(t.created_at)}
                  </time>
                </div>
                <blockquote className="thanks-inbox-item-message">
                  {t.message}
                </blockquote>
                <div className="thanks-inbox-item-actions">
                  <button
                    type="button"
                    className={`thanks-inbox-toggle${t.is_public ? ' is-on' : ''}`}
                    onClick={() => togglePublic(t.id, !t.is_public)}
                    aria-pressed={t.is_public}
                    title={
                      t.is_public
                        ? 'Видно всем на /t/[slug]'
                        : 'Видно только тебе'
                    }
                  >
                    <span aria-hidden="true">{t.is_public ? '🌐' : '🔒'}</span>{' '}
                    {t.is_public ? 'в стене' : 'скрыто'}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {items.length > 5 && (
        <button
          type="button"
          className="thanks-inbox-toggle-more"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded
            ? 'Свернуть'
            : `Показать ещё ${items.length - 5}`}
        </button>
      )}

      <ToastStack items={toasts} onDismiss={dismiss} />
    </section>
  );
}
