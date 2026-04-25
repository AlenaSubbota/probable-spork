'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { useToasts, ToastStack } from '@/components/ui/Toast';

interface Initial {
  slug: string;
  name: string;
  description: string;
  avatar_url: string;
  banner_url: string;
  accepts_coins_for_chapters: boolean;
}

interface Props {
  teamId: number;
  initial: Initial;
}

export default function TeamSettingsForm({ teamId, initial }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const { items: toasts, push, dismiss } = useToasts();

  const [slug, setSlug] = useState(initial.slug);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [avatarUrl, setAvatarUrl] = useState(initial.avatar_url);
  const [bannerUrl, setBannerUrl] = useState(initial.banner_url);
  const [acceptsCoins, setAcceptsCoins] = useState(initial.accepts_coins_for_chapters);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanSlug = slug.trim().toLowerCase();
    const cleanName = name.trim();
    if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(cleanSlug)) {
      push('error', 'Slug: латиница/цифры/тире, 3–40 символов.');
      return;
    }
    if (cleanName.length < 2) {
      push('error', 'Имя слишком короткое.');
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from('translator_teams')
      .update({
        slug: cleanSlug,
        name: cleanName,
        description: description.trim() || null,
        avatar_url: avatarUrl.trim() || null,
        banner_url: bannerUrl.trim() || null,
        accepts_coins_for_chapters: acceptsCoins,
      })
      .eq('id', teamId);
    setBusy(false);
    if (error) {
      const msg = error.message.includes('duplicate key')
        ? 'Этот slug уже занят.'
        : error.message;
      push('error', msg);
      return;
    }
    push('success', 'Сохранено.');
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="settings-block team-settings-form">
      <h2>Настройки команды</h2>

      <div className="form-field">
        <label htmlFor="team-name">Имя команды *</label>
        <input
          id="team-name"
          type="text"
          className="form-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          required
        />
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
            maxLength={40}
            required
          />
        </div>
      </div>

      <div className="form-field">
        <label htmlFor="team-desc">Описание</label>
        <textarea
          id="team-desc"
          className="form-textarea"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={1000}
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
          placeholder="https://…"
        />
      </div>

      <div className="form-field">
        <label htmlFor="team-banner">Баннер (URL, опционально)</label>
        <input
          id="team-banner"
          type="url"
          className="form-input"
          value={bannerUrl}
          onChange={(e) => setBannerUrl(e.target.value)}
          placeholder="https://… (картинка-обложка для шапки страницы)"
        />
      </div>

      <div className="form-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <input
          id="team-coins"
          type="checkbox"
          checked={acceptsCoins}
          onChange={(e) => setAcceptsCoins(e.target.checked)}
          style={{ width: 18, height: 18 }}
        />
        <label htmlFor="team-coins" style={{ margin: 0 }}>
          Принимаем монеты Chaptify за платные главы
        </label>
      </div>

      <div style={{ marginTop: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>

      <ToastStack items={toasts} onDismiss={dismiss} />
    </form>
  );
}
