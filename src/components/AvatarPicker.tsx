'use client';

import { useRef, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { AVATAR_PRESETS, describeAvatar } from '@/lib/avatar';

interface Props {
  userId: string;
  name: string | null;
  /** URL фото из user_metadata — Google / Telegram / Yandex / …
     Показываем под лейблом нужного провайдера. */
  externalPhotoUrl?: string | null;
  externalProvider?: 'google' | 'telegram' | 'yandex' | 'other' | null;
  value: string | null;
  onChange: (next: string | null) => void;
}

type Tab = 'upload' | 'preset' | 'external';

const PROVIDER_META: Record<
  NonNullable<Props['externalProvider']>,
  { label: string; tab: string; hint: string }
> = {
  google:   { label: 'Google',   tab: '🔵 Google',   hint: 'Возьмём аватарку из Google-аккаунта.' },
  telegram: { label: 'Telegram', tab: '💬 Telegram', hint: 'Возьмём аватарку из Telegram-аккаунта.' },
  yandex:   { label: 'Яндекс',   tab: '🟡 Яндекс',   hint: 'Возьмём аватарку из Яндекс-аккаунта.' },
  other:    { label: 'аккаунт',  tab: '👤 Из аккаунта', hint: 'Возьмём аватарку из подключённого аккаунта.' },
};

export default function AvatarPicker({
  userId,
  name,
  externalPhotoUrl,
  externalProvider,
  value,
  onChange,
}: Props) {
  const [tab, setTab] = useState<Tab>('upload');
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  const a = describeAvatar(value);

  // ---- Файл upload ----
  const handleFile = async (file: File) => {
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('Нужен файл-картинка (jpg, png, webp).');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setError('Максимум 3 МБ.');
      return;
    }
    setUploading(true);
    const supabase = createClient();
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });
    if (upErr) {
      setError(upErr.message);
      setUploading(false);
      return;
    }
    onChange(path);
    setUploading(false);
  };

  return (
    <div className="avatar-picker">
      <div className="avatar-picker-preview-wrap">
        <div className="avatar-picker-preview">
          {a.kind === 'image' ? (
            <img src={a.src} alt="" />
          ) : (
            <div
              className="avatar-picker-preview-fallback"
              style={{
                background:
                  a.kind === 'preset'
                    ? a.css
                    : 'linear-gradient(135deg, var(--accent), var(--rose))',
              }}
            >
              {initial}
            </div>
          )}
        </div>
        <div className="avatar-picker-hint">
          Так тебя видят другие
        </div>
      </div>

      <div className="avatar-picker-tabs">
        <button
          type="button"
          className={`chip${tab === 'upload' ? ' active' : ''}`}
          onClick={() => setTab('upload')}
        >
          📁 Загрузить
        </button>
        <button
          type="button"
          className={`chip${tab === 'preset' ? ' active' : ''}`}
          onClick={() => setTab('preset')}
        >
          🎨 Выбрать готовый
        </button>
        {externalPhotoUrl && (
          <button
            type="button"
            className={`chip${tab === 'external' ? ' active' : ''}`}
            onClick={() => setTab('external')}
          >
            {PROVIDER_META[externalProvider ?? 'other'].tab}
          </button>
        )}
      </div>

      {tab === 'upload' && (
        <div className="avatar-picker-body">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Загружаем…' : 'Выбрать файл'}
          </button>
          <p className="form-hint" style={{ margin: '8px 0 0' }}>
            jpg, png, webp до 3 МБ. Лучше квадратная картинка — её обрежем в круг.
          </p>
        </div>
      )}

      {tab === 'preset' && (
        <div className="avatar-picker-body">
          <div className="avatar-preset-grid">
            {AVATAR_PRESETS.map((p) => {
              const id = `preset:${p.id}`;
              const isActive = value === id;
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`avatar-preset${isActive ? ' active' : ''}`}
                  style={{ background: p.css }}
                  onClick={() => onChange(id)}
                  aria-label={`Пресет ${p.id}`}
                >
                  {initial}
                </button>
              );
            })}
          </div>
          <p className="form-hint" style={{ margin: '8px 0 0' }}>
            Цветной фон с первой буквой твоего имени. Быстро и красиво.
          </p>
        </div>
      )}

      {tab === 'external' && externalPhotoUrl && (
        <div className="avatar-picker-body">
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <img
              src={externalPhotoUrl}
              alt=""
              style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover' }}
            />
            <div>
              <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink-soft)' }}>
                {PROVIDER_META[externalProvider ?? 'other'].hint}
              </p>
              <button
                type="button"
                className="btn btn-primary"
                style={{ marginTop: 8 }}
                onClick={() => onChange(externalPhotoUrl)}
              >
                Использовать это фото
              </button>
            </div>
          </div>
        </div>
      )}

      {value && (
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => onChange(null)}
            style={{ padding: '0 12px', height: 30, fontSize: 12 }}
          >
            Сбросить на стандартный
          </button>
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--rose)', fontSize: 13, marginTop: 8 }}>{error}</div>
      )}
    </div>
  );
}
