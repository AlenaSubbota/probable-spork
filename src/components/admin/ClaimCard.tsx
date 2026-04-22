'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

export interface Claim {
  id: number;
  novel_id: number;
  novel_firebase_id: string;
  novel_title: string;
  external_name: string | null;
  claimant_id: string;
  claimant_name: string;
  claimant_slug: string | null;
  proof: string | null;
  created_at: string;
}

// Карточка заявки «это моя работа» для /admin/moderation. Админ одобряет
// (translator_id переписывается на claimant) или отклоняет с причиной.
export default function ClaimCard({ claim }: { claim: Claim }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const resolve = async (approve: boolean) => {
    setError(null);
    if (!approve && note.trim().length < 3) {
      setError('Напиши причину отказа хотя бы в пару слов.');
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error: err } = await supabase.rpc('resolve_novel_claim', {
      p_claim: claim.id,
      p_approve: approve,
      p_note: approve ? null : note.trim(),
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
      <div
        className="moderation-card-cover"
        style={{ display: 'grid', placeItems: 'center', fontSize: 28 }}
      >
        🔖
      </div>
      <div>
        <h3 className="moderation-card-title">
          <Link href={`/novel/${claim.novel_firebase_id}`}>
            {claim.novel_title}
          </Link>
        </h3>
        <div className="moderation-card-meta">
          <span>
            В карточке указан «{claim.external_name ?? '—'}» (внешний переводчик)
          </span>
        </div>
        <div className="moderation-card-meta" style={{ marginTop: 6 }}>
          <span>
            Заявитель:{' '}
            {claim.claimant_slug ? (
              <Link href={`/t/${claim.claimant_slug}`}>
                {claim.claimant_name}
              </Link>
            ) : (
              <strong>{claim.claimant_name}</strong>
            )}
          </span>
        </div>
        {claim.proof && (
          <p
            className="moderation-card-desc"
            style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}
          >
            <strong>Доказательства:</strong> {claim.proof}
          </p>
        )}
        {rejecting && (
          <div style={{ marginTop: 10 }}>
            <textarea
              className="form-input"
              rows={3}
              placeholder="Причина отказа — заявитель увидит её в уведомлении."
              value={note}
              onChange={(e) => setNote(e.target.value)}
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
        {!rejecting ? (
          <>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => resolve(true)}
              disabled={busy}
            >
              ✓ Подтвердить
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
              onClick={() => resolve(false)}
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
                setNote('');
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
