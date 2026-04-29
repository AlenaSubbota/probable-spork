'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

interface Props {
  /** Текущий ник пользователя — нужно ввести его слово-в-слово,
      чтобы случайный клик не превратился в удаление. */
  userName: string | null;
}

export default function DeleteAccountSection({ userName }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingSince, setPendingSince] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  // Узнаём, не висит ли уже запрос (на случай, если юзер удалил, потом
  // зашёл снова, увидел свою анонимизированную карточку и хочет понять,
  // что происходит).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc('get_my_deletion_status');
      if (cancelled) return;
      const r = data as { pending?: boolean; requested_at?: string } | null;
      if (r?.pending) setPendingSince(r.requested_at ?? null);
      setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const expectedText = userName && userName.trim().length > 0 ? userName : 'удалить';
  const matches =
    confirmText.trim().toLowerCase() === expectedText.toLowerCase();

  const submit = async () => {
    if (!matches) {
      setError(
        userName
          ? `Введи свой ник «${userName}» точно — это защита от случайного клика.`
          : 'Введи слово «удалить» для подтверждения.',
      );
      return;
    }
    setError(null);
    setBusy(true);
    const supabase = createClient();
    const { error: rpcErr } = await supabase.rpc('request_my_account_deletion', {
      p_confirm_text: confirmText.trim(),
      p_reason: reason.trim() || null,
    });
    setBusy(false);
    if (rpcErr) {
      const msg = rpcErr.message;
      if (msg.includes('confirm text mismatch')) {
        setError('Подтверждение не совпало. Введи свой ник точно так же.');
      } else if (msg.includes('auth required')) {
        setError('Сессия истекла, войди заново.');
      } else {
        setError(`Ошибка: ${msg}`);
      }
      return;
    }
    // Сразу разлогиниваем — после анонимизации сессия по факту
    // ничего не значит, не хочется, чтобы юзер видел свой кастрированный
    // профиль и пугался.
    await supabase.auth.signOut();
    router.push('/');
  };

  if (checking) return null;

  if (pendingSince) {
    return (
      <section
        className="card"
        style={{
          marginTop: 30,
          background: 'var(--bg-soft)',
          borderColor: 'var(--border)',
        }}
      >
        <h3 style={{ margin: '0 0 8px', fontFamily: 'var(--font-serif)' }}>
          Аккаунт уже в очереди на удаление
        </h3>
        <p style={{ margin: 0, color: 'var(--ink-soft)', fontSize: 14, lineHeight: 1.55 }}>
          Запрос подан{' '}
          <strong>
            {new Date(pendingSince).toLocaleDateString('ru-RU', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </strong>
          . Профиль уже анонимизирован: имя, аватар, описание скрыты, активные
          подписки приостановлены. Через 30 дней администратор уберёт
          техническую запись из аутентификации; до этого момента можно
          написать в{' '}
          <a href="https://t.me/chaptifybot" target="_blank" rel="noreferrer">
            @chaptifybot
          </a>
          , если решишь отменить.
        </p>
      </section>
    );
  }

  return (
    <section
      className="card"
      style={{
        marginTop: 30,
        borderColor: 'var(--rose-soft, var(--border))',
      }}
    >
      <h3
        style={{
          margin: '0 0 4px',
          fontFamily: 'var(--font-serif)',
          color: 'var(--rose, #c66464)',
        }}
      >
        Опасная зона
      </h3>
      <p style={{ margin: '0 0 12px', color: 'var(--ink-mute)', fontSize: 13 }}>
        Удаление аккаунта необратимо. Что произойдёт сразу:
      </p>
      <ul
        style={{
          margin: '0 0 14px 22px',
          padding: 0,
          color: 'var(--ink-soft)',
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        <li>имя, аватар, описание сменятся на «[удалён]»;</li>
        <li>
          комментарии и цитаты останутся (чтобы не повисли ответы), но
          уже без твоего ника;
        </li>
        <li>
          активные подписки на переводчиков переведутся в «отменено»;
        </li>
        <li>
          закладки, прогресс чтения и история сообщений удалятся в
          течение 30 дней (период «корзины»);
        </li>
        <li>
          платёжные записи останутся 3 года в обезличенном виде — по
          закону для налоговой.
        </li>
      </ul>

      {!open ? (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setOpen(true)}
          style={{
            color: 'var(--rose, #c66464)',
            borderColor: 'var(--rose-soft, var(--border))',
          }}
        >
          Удалить аккаунт
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ display: 'block', fontSize: 13, color: 'var(--ink-soft)' }}>
            {userName
              ? <>Чтобы подтвердить, введи свой ник <strong>«{userName}»</strong>:</>
              : <>Чтобы подтвердить, введи слово <strong>«удалить»</strong>:</>}
          </label>
          <input
            className="form-input"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={userName ?? 'удалить'}
            autoComplete="off"
            disabled={busy}
          />

          <label style={{ display: 'block', fontSize: 13, color: 'var(--ink-soft)', marginTop: 4 }}>
            Если хочешь — напиши пару слов, почему уходишь. Не обязательно.
          </label>
          <textarea
            className="form-textarea"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            disabled={busy}
            placeholder="Например: «нашла другой сайт», «было слишком сложно настроить»…"
          />

          {error && (
            <p style={{ color: 'var(--rose)', fontSize: 13, margin: 0 }}>{error}</p>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{
                background: 'var(--rose, #c66464)',
                borderColor: 'var(--rose, #c66464)',
              }}
              onClick={submit}
              disabled={busy || !matches}
            >
              {busy ? 'Удаляем…' : 'Удалить навсегда'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setOpen(false);
                setConfirmText('');
                setReason('');
                setError(null);
              }}
              disabled={busy}
            >
              Отмена
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
