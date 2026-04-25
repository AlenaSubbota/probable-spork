'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { useToasts, ToastStack } from '@/components/ui/Toast';

interface Props {
  suggestedSlug: string;
  suggestedName: string;
  suggestedAvatar: string | null;
}

export default function TeamCreateForm({
  suggestedSlug,
  suggestedName,
  suggestedAvatar,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const { items: toasts, push, dismiss } = useToasts();

  const [slug, setSlug] = useState(suggestedSlug);
  const [name, setName] = useState(suggestedName);
  const [description, setDescription] = useState('');
  const [avatarUrl, setAvatarUrl] = useState(suggestedAvatar ?? '');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanSlug = slug.trim().toLowerCase();
    const cleanName = name.trim();
    if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(cleanSlug)) {
      push('error', 'Slug: латиница/цифры/тире, 3–40 символов, не на дефис.');
      return;
    }
    if (cleanName.length < 2) {
      push('error', 'Имя команды слишком короткое.');
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc('create_my_team', {
      p_slug: cleanSlug,
      p_name: cleanName,
      p_description: description.trim() || null,
      p_avatar_url: avatarUrl.trim() || null,
    });
    setBusy(false);
    if (error) {
      const msg = error.message.includes('duplicate key')
        ? 'Этот slug уже занят — выбери другой.'
        : error.message;
      push('error', msg);
      return;
    }
    push('success', 'Команда создана.');
    setTimeout(() => router.push(`/admin/team/${data}/edit`), 400);
  };

  return (
    <form onSubmit={submit} className="settings-block team-create-form">
      <div className="form-field">
        <label htmlFor="team-name">Имя команды *</label>
        <input
          id="team-name"
          type="text"
          className="form-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Например: Лотос&Перо"
          maxLength={80}
          required
        />
        <div className="form-hint">Видно читателям как «перевод команды …».</div>
      </div>

      <div className="form-field">
        <label htmlFor="team-slug">Slug *</label>
        <div className="team-slug-input">
          <span className="team-slug-prefix">/team/</span>
          <input
            id="team-slug"
            type="text"
            className="form-input"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            placeholder="lotos-pero"
            maxLength={40}
            required
          />
        </div>
        <div className="form-hint">
          Адрес страницы команды. Латиница, цифры и тире.
        </div>
      </div>

      <div className="form-field">
        <label htmlFor="team-desc">Краткое описание</label>
        <textarea
          id="team-desc"
          className="form-textarea"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={1000}
          placeholder="О чём ваша команда: жанры, языки, любимое настроение текста."
        />
        <div className="form-hint">{description.length} / 1000</div>
      </div>

      <div className="form-field">
        <label htmlFor="team-avatar">Аватар (URL)</label>
        <input
          id="team-avatar"
          type="url"
          className="form-input"
          value={avatarUrl}
          onChange={(e) => setAvatarUrl(e.target.value)}
          placeholder="https://… (можно оставить пустым)"
        />
        <div className="form-hint">
          Любая ссылка на картинку. Загрузку файлов добавим позже.
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Создаём…' : '🪶 Создать команду'}
        </button>
      </div>

      <ToastStack items={toasts} onDismiss={dismiss} />
    </form>
  );
}
