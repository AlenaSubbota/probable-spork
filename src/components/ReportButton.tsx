'use client';

import { useState } from 'react';
import { createClient } from '@/utils/supabase/client';

type Target = 'comment' | 'novel' | 'quote';

interface Props {
  targetType: Target;
  /** ID цели жалобы. Для comment/novel — числовой ID, для quote — uuid.
      Передаётся в RPC как text, поэтому здесь принимаем строку. */
  targetId: string | number;
  /** Если кнопку открывает не залогиненный — показываем подсказку
      пройти. По умолчанию ничего не блокируем — RPC сам ругнётся. */
  isLoggedIn?: boolean;
  /** Компактный режим — без надписи, только символ предупреждения. */
  compact?: boolean;
  /** Подпись для скринридеров и тултипа. */
  label?: string;
}

const REASON_PROMPT =
  'Опиши, что не так — что нарушает правила и почему. От 5 до 1000 символов.';

const PRESET_REASONS: Record<Target, string[]> = {
  comment: [
    'Оскорбление / переход на личности',
    'Спам или реклама',
    'Спойлер без тега',
    'Доксинг или раскрытие личных данных',
    'Своя причина…',
  ],
  novel: [
    'Машинный перевод без пометки MTL',
    'Чужой перевод без согласия автора',
    'Контент 18+ без возрастного рейтинга',
    'Нарушение авторских прав',
    'Своя причина…',
  ],
  quote: [
    'Оскорбительный контент',
    'Спойлер крупного поворота',
    'Нарушение приватности',
    'Своя причина…',
  ],
};

const TARGET_LABEL: Record<Target, string> = {
  comment: 'комментарий',
  novel: 'новеллу',
  quote: 'цитату',
};

export default function ReportButton({
  targetType,
  targetId,
  isLoggedIn = true,
  compact = false,
  label,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [reason, setReason] = useState('');
  const [preset, setPreset] = useState<string | null>(null);

  const buttonLabel = label ?? `Пожаловаться на ${TARGET_LABEL[targetType]}`;

  const submit = async () => {
    setError(null);
    const finalReason =
      preset && preset !== 'Своя причина…'
        ? `${preset}${reason.trim() ? ` — ${reason.trim()}` : ''}`
        : reason.trim();
    if (finalReason.length < 5) {
      setError('Минимум 5 символов — опиши, что не так.');
      return;
    }
    if (finalReason.length > 1000) {
      setError('Слишком длинно. До 1000 символов.');
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error: rpcErr } = await supabase.rpc('submit_complaint', {
      p_target_type: targetType,
      p_target_id: String(targetId),
      p_reason: finalReason,
    });
    setBusy(false);
    if (rpcErr) {
      // Дружелюбные тексты для известных RPC-ошибок.
      const msg = rpcErr.message;
      if (msg.includes('too many complaints')) {
        setError('Слишком много жалоб подряд. Попробуй через час.');
      } else if (msg.includes('auth required')) {
        setError('Нужно войти, чтобы отправить жалобу.');
      } else if (msg.includes('not found')) {
        setError('Объект жалобы уже удалён.');
      } else {
        setError(`Ошибка: ${msg}`);
      }
      return;
    }
    setDone(true);
    setReason('');
    setPreset(null);
    // Закрываем окно с небольшой задержкой, чтобы успели прочесть «спасибо».
    setTimeout(() => {
      setOpen(false);
      setDone(false);
    }, 1600);
  };

  if (!isLoggedIn) {
    return (
      <button
        type="button"
        className="report-trigger"
        title="Войди, чтобы пожаловаться"
        onClick={() =>
          alert('Чтобы пожаловаться, нужно войти в аккаунт.')
        }
      >
        <span aria-hidden="true">⚠</span>
        {!compact && <span className="report-trigger-label">Пожаловаться</span>}
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        className="report-trigger"
        title={buttonLabel}
        aria-label={buttonLabel}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">⚠</span>
        {!compact && <span className="report-trigger-label">Пожаловаться</span>}
      </button>

      {open && (
        <div
          className="story-modal"
          role="dialog"
          aria-modal="true"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="story-modal-card report-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="story-modal-close"
              onClick={() => !busy && setOpen(false)}
              aria-label="Закрыть"
            >
              ×
            </button>
            <div style={{ padding: '22px 22px 24px' }}>
              <h3 className="story-modal-title">
                Пожаловаться на {TARGET_LABEL[targetType]}
              </h3>
              <p style={{ margin: '0 0 14px', color: 'var(--ink-mute)', fontSize: 13.5 }}>
                Спасибо, что помогаешь поддерживать порядок. Жалоба анонимна
                для других пользователей; модератор увидит её и разберётся.
              </p>

              {done ? (
                <p style={{ color: 'var(--leaf)', fontSize: 14 }}>
                  ✓ Жалоба отправлена. Спасибо.
                </p>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                    {PRESET_REASONS[targetType].map((p) => (
                      <button
                        type="button"
                        key={p}
                        className={`chip${preset === p ? ' active' : ''}`}
                        style={{ justifyContent: 'flex-start' }}
                        onClick={() => setPreset(p)}
                      >
                        {p}
                      </button>
                    ))}
                  </div>

                  <label style={{ display: 'block', fontSize: 13, color: 'var(--ink-soft)', marginBottom: 4 }}>
                    {preset === 'Своя причина…' || !preset
                      ? REASON_PROMPT
                      : 'Можно добавить пояснение (по желанию):'}
                  </label>
                  <textarea
                    className="form-textarea"
                    rows={4}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={1000}
                    placeholder={
                      preset && preset !== 'Своя причина…'
                        ? 'Например: «оскорбление в адрес другого читателя»'
                        : 'Опиши проблему…'
                    }
                  />
                  {error && (
                    <p style={{ color: 'var(--rose)', fontSize: 13, marginTop: 8 }}>
                      {error}
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={submit}
                      disabled={busy}
                    >
                      {busy ? 'Отправляем…' : 'Отправить'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setOpen(false)}
                      disabled={busy}
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
