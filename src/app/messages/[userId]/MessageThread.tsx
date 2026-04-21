'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { getCoverUrl, timeAgo } from '@/lib/format';

interface Message {
  id: number;
  sender_id: string;
  recipient_id: string;
  text: string;
  attached_novel_id: number | null;
  attached_chapter_number: number | null;
  created_at: string;
  read_at: string | null;
}

interface NovelPreview {
  title: string;
  firebase_id: string;
  cover_url: string | null;
}

interface Props {
  myId: string;
  otherId: string;
  initial: Message[];
  novelPreviewMap: Record<number, NovelPreview>;
}

// Распознаём ссылку на /novel/<fbId>/<n> в тексте сообщения — для киллер-фичи #2
const NOVEL_LINK_RE = /\/novel\/([a-z0-9-]+)\/(\d+)/i;

export default function MessageThread({ myId, otherId, initial, novelPreviewMap }: Props) {
  const [messages, setMessages] = useState<Message[]>(initial);
  const [previews, setPreviews] = useState<Record<number, NovelPreview>>(novelPreviewMap);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const supabase = createClient();

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from('direct_messages')
      .select('id, sender_id, recipient_id, text, attached_novel_id, attached_chapter_number, created_at, read_at')
      .or(
        `and(sender_id.eq.${myId},recipient_id.eq.${otherId}),and(sender_id.eq.${otherId},recipient_id.eq.${myId})`
      )
      .order('created_at', { ascending: true })
      .limit(500);
    if (Array.isArray(data)) {
      setMessages(data as Message[]);
      // Добавляем превью для новых attached_novel_ids
      const newNovelIds = (data as Message[])
        .map((m) => m.attached_novel_id)
        .filter((id): id is number => !!id && !previews[id]);
      if (newNovelIds.length > 0) {
        const { data: nd } = await supabase
          .from('novels')
          .select('id, title, firebase_id, cover_url')
          .in('id', Array.from(new Set(newNovelIds)));
        const next = { ...previews };
        for (const n of nd ?? []) {
          next[n.id] = {
            title: n.title,
            firebase_id: n.firebase_id,
            cover_url: n.cover_url,
          };
        }
        setPreviews(next);
      }
    }
    // Отмечаем как прочитанные
    await supabase.rpc('mark_dm_read', { p_other: otherId });
  }, [supabase, myId, otherId, previews]);

  // Polling каждые 10 сек — простейшая замена realtime для MVP
  useEffect(() => {
    const id = window.setInterval(refresh, 10_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  // Скролл вниз при новых сообщениях
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);

    // Киллер-фича #2: если вставил ссылку на главу — прикрепляем превью
    let attachedNovelFbId: string | null = null;
    let attachedChapterNum: number | null = null;
    const m = trimmed.match(NOVEL_LINK_RE);
    if (m) {
      attachedNovelFbId = m[1];
      attachedChapterNum = parseInt(m[2], 10);
    }

    let attachedNovelId: number | null = null;
    if (attachedNovelFbId) {
      const { data: nov } = await supabase
        .from('novels')
        .select('id, title, firebase_id, cover_url')
        .eq('firebase_id', attachedNovelFbId)
        .maybeSingle();
      if (nov) {
        attachedNovelId = nov.id;
        setPreviews((prev) => ({
          ...prev,
          [nov.id]: { title: nov.title, firebase_id: nov.firebase_id, cover_url: nov.cover_url },
        }));
      }
    }

    const { error: rpcError } = await supabase.rpc('send_direct_message', {
      p_to: otherId,
      p_text: trimmed,
      p_novel_id: attachedNovelId,
      p_chapter_num: attachedChapterNum,
    });
    if (rpcError) {
      setError(rpcError.message);
      setSending(false);
      return;
    }
    setText('');
    setSending(false);
    await refresh();
  };

  return (
    <>
      <div className="message-thread">
        {messages.length === 0 ? (
          <div className="message-empty">
            Пока нет сообщений. Начни разговор — поделись любимой главой или
            просто поздоровайся.
          </div>
        ) : (
          messages.map((m) => {
            const isMe = m.sender_id === myId;
            const preview = m.attached_novel_id ? previews[m.attached_novel_id] : null;
            return (
              <div
                key={m.id}
                className={`message-bubble${isMe ? ' message-bubble--me' : ''}`}
              >
                <div className="message-text">{m.text}</div>
                {preview && m.attached_chapter_number != null && (
                  <Link
                    href={`/novel/${preview.firebase_id}/${m.attached_chapter_number}`}
                    className="message-attach"
                  >
                    {preview.cover_url && (
                      <img
                        src={getCoverUrl(preview.cover_url) ?? ''}
                        alt=""
                        className="message-attach-cover"
                      />
                    )}
                    <div className="message-attach-body">
                      <div className="message-attach-title">{preview.title}</div>
                      <div className="message-attach-sub">
                        Глава {m.attached_chapter_number}
                      </div>
                    </div>
                  </Link>
                )}
                <div className="message-time">
                  {timeAgo(m.created_at)}
                  {isMe && m.read_at && <span className="message-read"> · ✓ прочитано</span>}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="message-composer">
        <textarea
          className="message-input"
          placeholder="Напиши сообщение… (ссылка на главу раскроется в превью)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend(e);
            }
          }}
          rows={2}
          maxLength={4000}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={sending || !text.trim()}
        >
          {sending ? '…' : 'Отправить'}
        </button>
      </form>
      {error && (
        <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 6 }}>{error}</div>
      )}
    </>
  );
}
