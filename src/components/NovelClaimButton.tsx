'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

interface Props {
  novelId: number;
  novelTitle: string;
  externalName: string;
}

type ClaimState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'approved' }
  | { kind: 'rejected'; note: string | null };

// «Это моя работа» — заявка от зарегистрированного переводчика, что это
// его новелла. Админ одобряет в /admin/moderation и новелла перевешивается
// на claimant_id.
export default function NovelClaimButton({
  novelId,
  novelTitle,
  externalName,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [proof, setProof] = useState('');
  const [status, setStatus] = useState<ClaimState>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);

  const loadStatus = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('novel_translator_claims')
      .select('status, reviewer_note')
      .eq('novel_id', novelId)
      .eq('claimant_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) {
      setStatus({ kind: 'idle' });
      return;
    }
    if (data.status === 'pending') setStatus({ kind: 'pending' });
    else if (data.status === 'approved') setStatus({ kind: 'approved' });
    else setStatus({ kind: 'rejected', note: data.reviewer_note ?? null });
  };

  const onOpen = () => {
    setOpen(true);
    loadStatus();
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase.rpc('request_novel_claim', {
      p_novel: novelId,
      p_proof: proof.trim() || null,
    });
    setBusy(false);
    if (err) {
      if (err.message.includes('claim_already_exists')) {
        setStatus({ kind: 'pending' });
      } else if (err.message.includes('novel_already_has_translator')) {
        setError('У этой новеллы уже есть зарегистрированный переводчик.');
      } else {
        setError(err.message);
      }
      return;
    }
    setStatus({ kind: 'pending' });
    router.refresh();
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost claim-btn"
        onClick={onOpen}
        title="Если это ты переводил(а) — можешь забрать новеллу себе"
      >
        Это моя работа →
      </button>

      {open && (
        <div
          className="story-modal"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
        >
          <div
            className="story-modal-card claim-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="story-modal-close"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
            <div className="claim-modal-body">
              <h3 className="story-modal-title">Забрать новеллу себе</h3>
              <p style={{ color: 'var(--ink-soft)', fontSize: 13.5, lineHeight: 1.55 }}>
                Сейчас в карточке указано «{externalName}». Если это ты переводил(а)
                эту новеллу — отправь заявку, админ проверит и привяжет новеллу к
                твоему аккаунту. После одобрения «{novelTitle}» появится в твоём
                профиле `/t/…` и в админке.
              </p>

              {status.kind === 'pending' && (
                <div className="claim-status claim-status--pending">
                  Заявка уже подана — ждём решения админа. Уведомление придёт
                  в центр уведомлений.
                </div>
              )}
              {status.kind === 'approved' && (
                <div className="claim-status claim-status--approved">
                  Заявка одобрена. Новелла уже закреплена за тобой.
                </div>
              )}
              {status.kind === 'rejected' && (
                <div className="claim-status claim-status--rejected">
                  Предыдущая заявка отклонена
                  {status.note ? `: ${status.note}` : '.'}
                  <br />
                  Можешь подать новую с более полными доказательствами.
                </div>
              )}

              {status.kind !== 'pending' && status.kind !== 'approved' && (
                <>
                  <div className="form-field" style={{ marginTop: 14 }}>
                    <label title="Ссылка на твой оригинал публикации, пост в Telegram / Boosty, скриншот из личных сообщений — всё, что подтверждает авторство.">
                      Доказательства авторства (необязательно, но помогает)
                    </label>
                    <textarea
                      className="form-input"
                      rows={3}
                      value={proof}
                      onChange={(e) => setProof(e.target.value)}
                      placeholder="Например: https://t.me/мой_канал/123 или «я Wick HDL, вот моя страница Boosty»"
                    />
                  </div>
                  {error && (
                    <div style={{ color: 'var(--rose)', fontSize: 13, marginTop: 6 }}>
                      {error}
                    </div>
                  )}
                  <div className="admin-form-footer" style={{ marginTop: 14 }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={submit}
                      disabled={busy}
                    >
                      {busy ? 'Отправляем…' : 'Подать заявку'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setOpen(false)}
                    >
                      Отмена
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
