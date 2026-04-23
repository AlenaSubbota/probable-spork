'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useToasts, ToastStack } from '@/components/ui/Toast';

interface Method {
  id: number;
  provider: 'boosty' | 'tribute' | 'vk_donut' | 'patreon' | 'other';
  url: string;
  instructions: string | null;
  enabled: boolean;
  sort_order: number;
}

const PROVIDER_META: Record<Method['provider'], { label: string; icon: string; hint: string }> = {
  boosty:   { label: 'Boosty',    icon: '💛', hint: 'Ссылка на твою страницу: boosty.to/<username>' },
  tribute:  { label: 'Tribute',   icon: '💰', hint: 'Ссылка на твой Tribute-канал' },
  vk_donut: { label: 'VK Donut',  icon: '🟦', hint: 'Ссылка на донат VK-сообщества' },
  patreon:  { label: 'Patreon',   icon: '🧡', hint: 'patreon.com/<username>' },
  other:    { label: 'Другое',    icon: '✨', hint: 'Произвольная платформа — объясни в инструкции' },
};

interface Props {
  translatorId: string;
}

// Мини-CRUD платёжных методов переводчика. Отображается в /profile/settings.
// Бэкфилл из старого profiles.payout_boosty_url уже выполнен в миграции 037.
export default function PaymentMethodsEditor({ translatorId }: Props) {
  const supabase = createClient();
  const { items: toasts, push, dismiss } = useToasts();

  const [methods, setMethods] = useState<Method[]>([]);
  const [loading, setLoading] = useState(true);

  // Форма добавления
  const [provider, setProvider] = useState<Method['provider']>('boosty');
  const [url, setUrl] = useState('');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('translator_payment_methods')
      .select('id, provider, url, instructions, enabled, sort_order')
      .eq('translator_id', translatorId)
      .order('sort_order', { ascending: true });
    setLoading(false);
    if (error) {
      push('error', `Не загрузились: ${error.message}`);
      return;
    }
    setMethods((data ?? []) as Method[]);
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translatorId]);

  const handleAdd = async () => {
    const cleanUrl = url.trim();
    if (cleanUrl.length < 5) {
      push('error', 'Укажи ссылку.');
      return;
    }
    if (!/^https?:\/\//i.test(cleanUrl)) {
      push('error', 'Ссылка должна начинаться с https:// или http://.');
      return;
    }
    setBusy(true);
    const maxSort = methods.reduce((m, r) => Math.max(m, r.sort_order), 0);
    const { error } = await supabase.from('translator_payment_methods').insert({
      translator_id: translatorId,
      provider,
      url: cleanUrl,
      instructions: instructions.trim() || null,
      sort_order: maxSort + 1,
    });
    setBusy(false);
    if (error) {
      push('error', `Не добавилось: ${error.message}`);
      return;
    }
    setUrl('');
    setInstructions('');
    push('success', 'Метод добавлен.');
    reload();
  };

  const handleToggle = async (m: Method) => {
    const { error } = await supabase
      .from('translator_payment_methods')
      .update({ enabled: !m.enabled })
      .eq('id', m.id);
    if (error) {
      push('error', error.message);
      return;
    }
    reload();
  };

  const handleRemove = async (id: number) => {
    if (!confirm('Удалить этот способ оплаты?')) return;
    const { error } = await supabase
      .from('translator_payment_methods')
      .delete()
      .eq('id', id);
    if (error) {
      push('error', error.message);
      return;
    }
    push('success', 'Удалено.');
    reload();
  };

  const handleMove = async (id: number, dir: -1 | 1) => {
    const idx = methods.findIndex((m) => m.id === id);
    const neigh = methods[idx + dir];
    if (idx < 0 || !neigh) return;
    const me = methods[idx];
    await supabase
      .from('translator_payment_methods')
      .update({ sort_order: neigh.sort_order })
      .eq('id', me.id);
    await supabase
      .from('translator_payment_methods')
      .update({ sort_order: me.sort_order })
      .eq('id', neigh.id);
    reload();
  };

  return (
    <section className="settings-block">
      <h2>Способы оплаты</h2>
      <p style={{ color: 'var(--ink-mute)', fontSize: 13.5, marginTop: -8, marginBottom: 14 }}>
        Куда читатели отправляют деньги. Chaptify не проводит платежи через
        себя — ты получаешь напрямую. На paywall платных глав читатели увидят
        все подключённые способы.
      </p>

      {loading ? (
        <p style={{ color: 'var(--ink-mute)', fontSize: 13 }}>Загружаем…</p>
      ) : methods.length === 0 ? (
        <div className="empty-state" style={{ padding: 14, textAlign: 'left' }}>
          <p style={{ margin: 0 }}>
            Пока ни одной платформы не подключено. Читатели не смогут оплатить
            платные главы — покажется только пункт «монеты» (если включён).
          </p>
        </div>
      ) : (
        <div className="payment-methods-list">
          {methods.map((m, idx) => {
            const meta = PROVIDER_META[m.provider];
            return (
              <div
                key={m.id}
                className={`payment-method-row${m.enabled ? '' : ' is-disabled'}`}
              >
                <div className="payment-method-icon" aria-hidden="true">
                  {meta.icon}
                </div>
                <div className="payment-method-body">
                  <div className="payment-method-title">
                    {meta.label}
                    {!m.enabled && <span className="payment-method-badge">выкл.</span>}
                  </div>
                  <div className="payment-method-url">
                    <a href={m.url} target="_blank" rel="noreferrer noopener">
                      {m.url}
                    </a>
                  </div>
                  {m.instructions && (
                    <div className="payment-method-instr">{m.instructions}</div>
                  )}
                </div>
                <div className="payment-method-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => handleMove(m.id, -1)}
                    disabled={idx === 0}
                    aria-label="Выше"
                  >↑</button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => handleMove(m.id, 1)}
                    disabled={idx === methods.length - 1}
                    aria-label="Ниже"
                  >↓</button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => handleToggle(m)}
                    title={m.enabled ? 'Выключить' : 'Включить'}
                  >
                    {m.enabled ? '⊘' : '✓'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => handleRemove(m.id)}
                    title="Удалить"
                  >🗑</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="payment-methods-add">
        <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 15, margin: '0 0 10px' }}>
          Добавить способ
        </h3>

        <div className="form-field">
          <label>Платформа</label>
          <select
            className="form-input"
            value={provider}
            onChange={(e) => setProvider(e.target.value as Method['provider'])}
            style={{ maxWidth: 240 }}
          >
            {(Object.keys(PROVIDER_META) as Method['provider'][]).map((p) => (
              <option key={p} value={p}>
                {PROVIDER_META[p].icon} {PROVIDER_META[p].label}
              </option>
            ))}
          </select>
          <div className="form-hint">{PROVIDER_META[provider].hint}</div>
        </div>

        <div className="form-field">
          <label>Ссылка *</label>
          <input
            type="url"
            className="form-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://boosty.to/alena"
            maxLength={500}
          />
        </div>

        <div className="form-field">
          <label>Инструкция для читателей (необязательно)</label>
          <input
            className="form-input"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            maxLength={500}
            placeholder='Например: "оплати тир «Фанат» 299₽ и напиши мне в ЛС"'
          />
        </div>

        <button
          type="button"
          className="btn btn-primary"
          onClick={handleAdd}
          disabled={busy || !url.trim()}
        >
          {busy ? 'Добавляем…' : '＋ Добавить способ'}
        </button>
      </div>

      <ToastStack items={toasts} onDismiss={dismiss} />
    </section>
  );
}
