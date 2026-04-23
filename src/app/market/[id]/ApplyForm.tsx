'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { useToasts, ToastStack } from '@/components/ui/Toast';

interface Props {
  listingId: number;
}

export default function ApplyForm({ listingId }: Props) {
  const router = useRouter();
  const { items: toasts, push: pushToast, dismiss } = useToasts();
  const [message, setMessage] = useState('');
  const [portfolio, setPortfolio] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = message.trim();
    if (trimmed.length < 5) {
      pushToast('error', 'Напиши коротко о себе — хотя бы пару слов.');
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      pushToast('error', 'Нужна авторизация.');
      setBusy(false);
      return;
    }
    const { error } = await supabase.from('marketplace_applications').insert({
      listing_id: listingId,
      applicant_id: user.id,
      message: trimmed,
      portfolio_url: portfolio.trim() || null,
    });
    setBusy(false);
    if (error) {
      pushToast('error', `Не отправилось: ${error.message}`);
      return;
    }
    pushToast('success', 'Отклик отправлен. Автор объявления увидит.');
    router.refresh();
  };

  return (
    <form className="apply-form" onSubmit={submit}>
      <h3>Откликнуться</h3>
      <div className="form-field">
        <label>Сообщение автору *</label>
        <textarea
          className="form-textarea"
          rows={4}
          maxLength={1500}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Расскажи о своём опыте, почему подходишь, что можешь предложить."
          required
        />
        <div className="form-hint">{message.length}/1500</div>
      </div>

      <div className="form-field">
        <label>Ссылка на портфолио (необязательно)</label>
        <input
          type="url"
          className="form-input"
          value={portfolio}
          onChange={(e) => setPortfolio(e.target.value)}
          maxLength={500}
          placeholder="Твой Tumblr, TG-канал, другой перевод — что угодно"
        />
      </div>

      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'Отправляем…' : 'Отправить отклик'}
      </button>

      <ToastStack items={toasts} onDismiss={dismiss} />
    </form>
  );
}
