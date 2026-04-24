'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

const LANGUAGES = [
  { key: 'kr', label: 'Корейский' },
  { key: 'cn', label: 'Китайский' },
  { key: 'jp', label: 'Японский' },
  { key: 'en', label: 'Английский' },
];

export default function TranslatorApplyForm() {
  const router = useRouter();
  const [motivation, setMotivation] = useState('');
  const [portfolio, setPortfolio] = useState('');
  const [slug, setSlug] = useState('');
  const [langs, setLangs] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const toggleLang = (k: string) => {
    setLangs((prev) => (prev.includes(k) ? prev.filter((l) => l !== k) : [...prev, k]));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (motivation.trim().length < 20) {
      setError('Расскажи чуть подробнее — минимум 20 символов.');
      return;
    }
    setStatus('submitting');
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setStatus('error');
      setError('Нужна авторизация.');
      return;
    }
    const { error: dbError } = await supabase.from('translator_applications').insert({
      user_id: user.id,
      motivation: motivation.trim(),
      portfolio_url: portfolio.trim() || null,
      desired_slug: slug.trim() || null,
      languages: langs.length > 0 ? langs : null,
    });
    if (dbError) {
      setStatus('error');
      setError(dbError.message);
      return;
    }
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="card" style={{ padding: 24 }}>
      <div className="form-field">
        <label htmlFor="motivation">Почему хочешь переводить?</label>
        <textarea
          id="motivation"
          className="form-textarea"
          rows={5}
          value={motivation}
          onChange={(e) => setMotivation(e.target.value)}
          placeholder="Расскажи, какие новеллы ты уже переводил_а, что любишь в жанре, почему нравится именно Chaptify."
          required
        />
        <div className="form-hint">{motivation.length} / 2000</div>
      </div>

      <div className="form-field">
        <label htmlFor="portfolio">Ссылка на портфолио или уже переведённые главы</label>
        <input
          id="portfolio"
          className="form-input"
          type="url"
          value={portfolio}
          onChange={(e) => setPortfolio(e.target.value)}
          placeholder="https://… (опционально)"
        />
      </div>

      <div className="form-field">
        <label>Языки, с которых переводишь</label>
        <div className="filter-pills">
          {LANGUAGES.map((l) => (
            <button
              key={l.key}
              type="button"
              className={`filter-pill${langs.includes(l.key) ? ' active' : ''}`}
              onClick={() => toggleLang(l.key)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div className="form-field">
        <label htmlFor="slug">Желаемый slug (можно позже сменить)</label>
        <input
          id="slug"
          className="form-input"
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value.replace(/[^a-z0-9-]/g, ''))}
          placeholder="например, alena или ivan"
          maxLength={40}
        />
        <div className="form-hint">Только латиница, цифры и тире.</div>
      </div>

      <div
        style={{
          marginTop: 4,
          marginBottom: 16,
          padding: 12,
          background: 'var(--surface-alt, #faf7f0)',
          border: '1px solid var(--border, rgba(0,0,0,0.08))',
          borderRadius: 8,
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        <strong>💛 Две модели монетизации — подписка и монеты</strong>
        <div style={{ color: 'var(--ink-mute)', marginTop: 6 }}>
          После одобрения в{' '}
          <code>/profile/settings → Способы оплаты</code> подключаешь то, через
          что уже принимаешь деньги — Boosty, Tribute, VK Donut, карту.
          Chaptify сам платежи не проводит, деньги идут <b>напрямую тебе</b>.
          <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
            <li>
              <b>Подписка читателя на тебя</b> (за 149/198/250 ₽ в месяц на
              Boosty, например) → открывает все твои платные главы. Если
              подключён <b>Boosty-автосинк</b> (букмарклет на 1 клик либо
              закрытый TG-чат-перк с <b>@chaptifybot</b>) — заявка читателя
              одобряется сразу, <b>без ручных «одобрить» в админке</b>.
            </li>
            <li>
              <b>Монеты читателя у тебя</b> (он донатит условно 300 ₽ → у него
              появляется 300 «твоих» монет, которые тратятся на отдельные
              твои главы) → читатель переводит донат на твой Boosty / Tribute /
              карту с кодом в комментарии.
              <ul>
                <li>
                  <b>Tribute (если подключён webhook)</b> — автомат: донат с
                  кодом и совпадающей суммой сам зачисляет монеты. Видишь
                  результат в <code>/admin/subscribers</code> → Активные.
                </li>
                <li>
                  <b>Boosty / карта / VK</b> — вручную: сверяешь сумму и код
                  в своей панели платёжки, жмёшь «Одобрить».
                </li>
              </ul>
            </li>
            <li>
              <b>Tribute подписки</b> — тоже автомат: Tribute сам шлёт нам
              webhook при каждой оплате, подписка активируется без твоего
              участия (даже если читатель ещё не зашёл на сайт, его оплата
              сохраняется и применится при логине).
            </li>
            <li>
              VK Donut / Patreon — автосинка пока нет, любые заявки
              подтверждаешь руками.
            </li>
          </ul>
        </div>
      </div>

      {error && (
        <div style={{ color: 'var(--rose)', fontSize: 13, marginBottom: 12 }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={status === 'submitting'}
        >
          {status === 'submitting' ? 'Отправляем…' : 'Отправить заявку'}
        </button>
        <span className="note" style={{ fontSize: 11 }}>
          Заявку рассмотрим за 1–3 дня
        </span>
      </div>
    </form>
  );
}
