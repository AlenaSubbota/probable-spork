'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { useToasts, ToastStack } from '@/components/ui/Toast';

interface Props {
  translatorId: string;
  translatorDisplayName: string | null;
  novelId: number;
  chapterNumber: number;
  isLoggedIn: boolean;
  // user.id текущего читателя — чтобы не показывать форму на своих
  // же главах (translator_id === reader_id запрещено в БД).
  currentUserId: string | null;
  /** Публичный slug команды/переводчика — ссылка «вся стена → /t/[slug]». */
  translatorSlug: string | null;
}

interface SavedShape {
  id: number;
  message: string;
  is_public: boolean;
}

// «Сказать спасибо лично» — короткое личное сообщение переводчику.
// Отдельно от ♥ ChapterThanks (та — клик-эмоция). Сообщение появляется
// на дашборде переводчика и (если is_public) на стене /t/[slug].
//
// Денег не трогает. Это только эмоциональный канал.
export default function ThanksMessageForm({
  translatorId,
  translatorDisplayName,
  novelId,
  chapterNumber,
  isLoggedIn,
  currentUserId,
  translatorSlug,
}: Props) {
  const supabase = createClient();
  const { items: toasts, push, dismiss } = useToasts();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [latest, setLatest] = useState<SavedShape | null>(null);

  // Подтянуть «моё последнее сообщение этому переводчику по этой главе»
  // — чтобы не предлагать форму, если я уже писал. Перезаписать всё
  // равно нельзя (множественные сообщения — это нормально), но плашку
  // «уже отправлено» показываем.
  useEffect(() => {
    if (!isLoggedIn || !currentUserId || currentUserId === translatorId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('translator_thanks')
        .select('id, message, is_public')
        .eq('reader_id', currentUserId)
        .eq('translator_id', translatorId)
        .eq('novel_id', novelId)
        .eq('chapter_number', chapterNumber)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled && data) setLatest(data as SavedShape);
    })();
    return () => { cancelled = true; };
  }, [supabase, isLoggedIn, currentUserId, translatorId, novelId, chapterNumber]);

  // Скрываем компонент в трёх случаях: аноним; нет переводчика
  // у новеллы; читатель — это сам переводчик (нет смысла спасибо себе).
  if (!isLoggedIn) return null;
  if (!translatorId) return null;
  if (currentUserId === translatorId) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = message.trim();
    if (clean.length < 3) {
      push('error', 'Минимум 3 символа.');
      return;
    }
    setBusy(true);
    const { data, error } = await supabase
      .from('translator_thanks')
      .insert({
        reader_id: currentUserId!,
        translator_id: translatorId,
        novel_id: novelId,
        chapter_number: chapterNumber,
        message: clean,
        is_public: isPublic,
      })
      .select('id, message, is_public')
      .single();
    setBusy(false);
    if (error) {
      push('error', error.message);
      return;
    }
    setLatest(data as SavedShape);
    setMessage('');
    setOpen(false);
    push('success', isPublic ? 'Отправлено в стену.' : 'Отправлено лично.');
  };

  // Saved-state
  if (latest && !open) {
    return (
      <div className="thanks-msg thanks-msg--saved">
        <div className="thanks-msg-saved-icon" aria-hidden="true">💌</div>
        <div className="thanks-msg-saved-body">
          <div className="thanks-msg-saved-title">
            Письмо переводчику{' '}
            {latest.is_public && translatorSlug ? (
              <Link href={`/t/${translatorSlug}#thanks-wall`} className="thanks-msg-saved-link">
                в стене благодарностей
              </Link>
            ) : (
              <span>отправлено лично</span>
            )}
          </div>
          <div className="thanks-msg-saved-text">«{latest.message}»</div>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setOpen(true)}
          style={{ height: 36, fontSize: 13 }}
        >
          Ещё одно
        </button>
        <ToastStack items={toasts} onDismiss={dismiss} />
      </div>
    );
  }

  // Closed CTA
  if (!open) {
    return (
      <button
        type="button"
        className="thanks-msg thanks-msg--cta"
        onClick={() => setOpen(true)}
      >
        <span className="thanks-msg-cta-icon" aria-hidden="true">💌</span>
        <span className="thanks-msg-cta-text">
          <strong>Сказать спасибо лично</strong>
          <span className="thanks-msg-cta-sub">
            {translatorDisplayName
              ? `Письмо для ${translatorDisplayName} — увидит на дашборде, может попасть в стену благодарностей.`
              : 'Письмо переводчику — увидит на дашборде, может попасть в стену.'}
          </span>
        </span>
        <span className="thanks-msg-cta-arrow" aria-hidden="true">→</span>
        <ToastStack items={toasts} onDismiss={dismiss} />
      </button>
    );
  }

  // Open form
  return (
    <form onSubmit={submit} className="thanks-msg thanks-msg--form">
      <div className="thanks-msg-head">
        <span className="thanks-msg-head-icon" aria-hidden="true">💌</span>
        <span className="thanks-msg-head-text">
          {translatorDisplayName
            ? `Спасибо ${translatorDisplayName}`
            : 'Спасибо переводчику'}
        </span>
        <button
          type="button"
          className="thanks-msg-close"
          onClick={() => setOpen(false)}
          aria-label="Закрыть форму"
        >
          ×
        </button>
      </div>

      <div className="form-field">
        <label htmlFor="thanks-msg-text">Сообщение *</label>
        <textarea
          id="thanks-msg-text"
          className="form-textarea"
          rows={3}
          maxLength={500}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Напиши коротко — что зацепило, какая глава особенно. Без денег, просто слова."
          required
        />
        <div className="form-hint" aria-live="polite">
          {message.length} / 500
        </div>
      </div>

      <label className="thanks-msg-public">
        <input
          type="checkbox"
          checked={isPublic}
          onChange={(e) => setIsPublic(e.target.checked)}
        />
        <span>
          Опубликовать в стене благодарностей переводчика
          <span className="thanks-msg-public-sub">
            Если выключено — увидит только сам переводчик. Можно изменить решение позже не получится.
          </span>
        </span>
      </label>

      <div className="thanks-msg-actions">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || message.trim().length < 3}
        >
          {busy ? 'Отправляем…' : '💌 Отправить'}
        </button>
      </div>

      <ToastStack items={toasts} onDismiss={dismiss} />
    </form>
  );
}
