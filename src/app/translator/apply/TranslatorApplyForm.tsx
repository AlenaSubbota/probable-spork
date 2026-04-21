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
