'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { getCoverUrl } from '@/lib/format';

export interface ModerationNovel {
  id: number;
  firebase_id: string;
  title: string;
  cover_url: string | null;
  description: string | null;
  chapter_count: number | null;
  age_rating: string | null;
  genres: string[] | null;
  translator_display_name: string | null;
  translator_slug: string | null;
}

interface Props {
  novel: ModerationNovel;
}

// Карточка на странице `/admin/moderation`. Две кнопки (одобрить / отклонить),
// при клике «отклонить» открывается inline-textarea для причины.
// Под капотом — RPC review_novel(p_novel, p_approve, p_note).
export default function ModerationCard({ novel }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const review = async (approve: boolean) => {
    setError(null);
    if (!approve && reason.trim().length < 3) {
      setError('Напиши причину хотя бы в пару слов.');
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error: err } = await supabase.rpc('review_novel', {
      p_novel: novel.id,
      p_approve: approve,
      p_note: approve ? null : reason.trim(),
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    router.refresh();
  };

  return (
    <div className="moderation-card">
      <div className="moderation-card-cover">
        {novel.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={getCoverUrl(novel.cover_url) ?? ''} alt="" />
        ) : (
          <div className="placeholder p1" style={{ fontSize: 10 }}>
            {novel.title}
          </div>
        )}
      </div>
      <div>
        <h3 className="moderation-card-title">
          <Link href={`/novel/${novel.firebase_id}`}>{novel.title}</Link>
        </h3>
        <div className="moderation-card-meta">
          <span>
            от {' '}
            {novel.translator_slug ? (
              <Link href={`/t/${novel.translator_slug}`}>
                {novel.translator_display_name ?? 'переводчика'}
              </Link>
            ) : (
              novel.translator_display_name ?? 'переводчика'
            )}
          </span>
          <span>· {novel.chapter_count ?? 0} гл.</span>
          {novel.age_rating && <span>· {novel.age_rating}</span>}
          {novel.genres && novel.genres.length > 0 && (
            <span>· {novel.genres.slice(0, 3).join(', ')}</span>
          )}
        </div>
        {novel.description && (
          <p
            className="moderation-card-desc"
            dangerouslySetInnerHTML={{ __html: novel.description }}
          />
        )}
        {rejecting && (
          <div style={{ marginTop: 10 }}>
            <textarea
              className="form-input"
              rows={3}
              placeholder="Причина отказа — переводчик увидит её в уведомлении и на своей карточке новеллы."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        )}
        {error && (
          <div style={{ color: 'var(--rose)', fontSize: 12, marginTop: 6 }}>
            {error}
          </div>
        )}
      </div>
      <div className="moderation-card-actions">
        <Link
          href={`/admin/novels/${novel.firebase_id}/edit`}
          className="btn btn-ghost"
          style={{ height: 34 }}
        >
          Посмотреть
        </Link>
        {!rejecting ? (
          <>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => review(true)}
              disabled={busy}
            >
              ✓ Одобрить
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setRejecting(true)}
              disabled={busy}
              style={{ color: 'var(--rose)' }}
            >
              Отклонить
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => review(false)}
              disabled={busy}
              style={{ background: 'var(--rose)', borderColor: 'var(--rose)' }}
            >
              {busy ? 'Отклоняем…' : 'Подтвердить отказ'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setRejecting(false);
                setReason('');
                setError(null);
              }}
              disabled={busy}
            >
              Отмена
            </button>
          </>
        )}
      </div>
    </div>
  );
}
