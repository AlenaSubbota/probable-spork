'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import NovelMultiPicker, { type PickedNovel } from './NovelMultiPicker';

const COLLECTION_MAX_NOVELS = 50;

const EMOJI_PRESETS = ['✦', '🍵', '⚔️', '🐉', '💌', '🌙', '🔥', '💕', '🥺', '😄', '🧠', '📚', '🌸', '🎭', '👑'];

export interface CollectionFormValues {
  slug: string;
  title: string;
  tagline: string;
  description: string;
  emoji: string;
  is_published: boolean;
  is_featured: boolean;
  novels: PickedNovel[];
}

interface Props {
  mode: 'create' | 'edit';
  /** ID существующей подборки в режиме edit. */
  collectionId?: number;
  initial?: Partial<CollectionFormValues>;
  isAdmin: boolean;
}

const EMPTY: CollectionFormValues = {
  slug: '',
  title: '',
  tagline: '',
  description: '',
  emoji: '✦',
  is_published: false,
  is_featured: false,
  novels: [],
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

function makeSlug(title: string): string {
  const map: Record<string, string> = {
    а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',к:'k',
    л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',
    ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
  };
  let out = '';
  for (const ch of title.toLowerCase()) {
    if (map[ch] !== undefined) out += map[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else if (/\s|-/.test(ch)) out += '-';
  }
  return out.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
}

export default function CollectionForm({
  mode,
  collectionId,
  initial,
  isAdmin,
}: Props) {
  const router = useRouter();
  const [values, setValues] = useState<CollectionFormValues>({ ...EMPTY, ...initial });
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Авто-слаг из заголовка только в create-режиме и пока пользователь
  // сам не правил slug.
  const [slugTouched, setSlugTouched] = useState(mode === 'edit');

  function set<K extends keyof CollectionFormValues>(k: K, v: CollectionFormValues[K]) {
    setValues((prev) => ({ ...prev, [k]: v }));
  }

  const onTitleChange = (t: string) => {
    set('title', t);
    if (!slugTouched) {
      set('slug', makeSlug(t));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const title = values.title.trim();
    const slug = values.slug.trim().toLowerCase();
    if (!title) {
      setError('Укажи название подборки.');
      return;
    }
    if (!SLUG_RE.test(slug)) {
      setError('Slug должен содержать только латиницу/цифры/дефисы (3–50 символов, не на дефис).');
      return;
    }
    if (values.novels.length === 0 && values.is_published) {
      setError('Опубликовать пустую подборку нельзя — добавь хотя бы одну новеллу.');
      return;
    }

    setSubmitting(true);
    const supabase = createClient();

    const novelIds = values.novels.map((n) => n.firebase_id);
    const payload = {
      slug,
      title,
      tagline: values.tagline.trim() || null,
      description: values.description.trim() || null,
      emoji: values.emoji || '✦',
      novel_ids: novelIds,
      is_published: values.is_published,
      // is_featured учитывается, но триггер откатит изменение, если не админ
      is_featured: values.is_featured,
    };

    if (mode === 'create') {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('Сессия истекла. Войди ещё раз.');
        setSubmitting(false);
        return;
      }
      const { data, error: insErr } = await supabase
        .from('collections')
        .insert({ ...payload, owner_id: user.id })
        .select('id, slug')
        .single();
      if (insErr) {
        setError(messageFor(insErr.message));
        setSubmitting(false);
        return;
      }
      router.push(`/collection/${data.slug}`);
      router.refresh();
      return;
    }

    if (!collectionId) {
      setError('Не задан id подборки.');
      setSubmitting(false);
      return;
    }
    const { error: updErr } = await supabase
      .from('collections')
      .update(payload)
      .eq('id', collectionId);
    if (updErr) {
      setError(messageFor(updErr.message));
      setSubmitting(false);
      return;
    }
    router.push(`/collection/${slug}`);
    router.refresh();
  };

  const handleDelete = async () => {
    if (!collectionId) return;
    if (!confirm('Удалить подборку? Действие нельзя отменить.')) return;
    setDeleting(true);
    const supabase = createClient();
    const { error: delErr } = await supabase
      .from('collections')
      .delete()
      .eq('id', collectionId);
    if (delErr) {
      setError(messageFor(delErr.message));
      setDeleting(false);
      return;
    }
    router.push('/collections');
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="collection-form">
      <div className="collection-form-grid">
        <label className="collection-form-field collection-form-emoji-field">
          <span className="collection-form-label">Эмодзи</span>
          <div className="collection-form-emoji-row">
            <input
              type="text"
              value={values.emoji}
              onChange={(e) => set('emoji', e.target.value.slice(0, 8))}
              maxLength={8}
              className="collection-form-emoji-input"
            />
            <div className="collection-form-emoji-presets">
              {EMOJI_PRESETS.map((e) => (
                <button
                  type="button"
                  key={e}
                  onClick={() => set('emoji', e)}
                  className={`collection-form-emoji-preset${values.emoji === e ? ' is-active' : ''}`}
                  aria-label={`Выбрать эмодзи ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        </label>

        <label className="collection-form-field collection-form-title-field">
          <span className="collection-form-label">Название</span>
          <input
            type="text"
            value={values.title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Например: Уютный Восток"
            maxLength={120}
            required
            className="collection-form-input"
          />
        </label>

        <label className="collection-form-field collection-form-slug-field">
          <span className="collection-form-label">Slug (URL)</span>
          <div className="collection-form-slug-wrap">
            <span className="collection-form-slug-prefix">/collection/</span>
            <input
              type="text"
              value={values.slug}
              onChange={(e) => {
                setSlugTouched(true);
                set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
              }}
              placeholder="cozy-east"
              maxLength={50}
              required
              className="collection-form-input"
            />
          </div>
        </label>

        <label className="collection-form-field collection-form-tagline-field">
          <span className="collection-form-label">Подзаголовок</span>
          <input
            type="text"
            value={values.tagline}
            onChange={(e) => set('tagline', e.target.value)}
            placeholder="Когда хочется чая, тишины и неспешного сюжета."
            maxLength={240}
            className="collection-form-input"
          />
        </label>

        <label className="collection-form-field collection-form-description-field">
          <span className="collection-form-label">Описание (необязательно)</span>
          <textarea
            value={values.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Длинное описание для страницы подборки. Можно несколько абзацев."
            rows={5}
            maxLength={4000}
            className="collection-form-textarea"
          />
        </label>
      </div>

      <div className="collection-form-novels">
        <div className="collection-form-label">Новеллы в подборке</div>
        <NovelMultiPicker
          value={values.novels}
          onChange={(next) => set('novels', next)}
          max={COLLECTION_MAX_NOVELS}
        />
      </div>

      <div className="collection-form-flags">
        <label className="collection-form-flag">
          <input
            type="checkbox"
            checked={values.is_published}
            onChange={(e) => set('is_published', e.target.checked)}
          />
          <span>
            <strong>Опубликовать</strong>
            <small>Подборка будет видна всем посетителям сайта.</small>
          </span>
        </label>
        {isAdmin && (
          <label className="collection-form-flag">
            <input
              type="checkbox"
              checked={values.is_featured}
              onChange={(e) => set('is_featured', e.target.checked)}
            />
            <span>
              <strong>Закрепить на главной</strong>
              <small>Только для админов. Появится в блоке «Подборки от редакции».</small>
            </span>
          </label>
        )}
      </div>

      {error && <div className="collection-form-error">{error}</div>}

      <div className="collection-form-actions">
        <button
          type="submit"
          disabled={submitting || deleting}
          className="btn btn-primary"
        >
          {submitting ? 'Сохраняю…' : mode === 'create' ? 'Создать подборку' : 'Сохранить'}
        </button>
        <Link href="/collections" className="btn btn-ghost">
          Отмена
        </Link>
        {mode === 'edit' && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={submitting || deleting}
            className="btn btn-ghost collection-form-delete"
          >
            {deleting ? 'Удаляю…' : 'Удалить'}
          </button>
        )}
      </div>
    </form>
  );
}

function messageFor(raw: string): string {
  if (raw.includes('duplicate key') || raw.includes('unique')) {
    return 'Slug уже занят — выбери другой.';
  }
  if (raw.includes('row-level security')) {
    return 'Нет прав на это действие. Войди как переводчик или админ.';
  }
  if (raw.includes('check constraint')) {
    return 'Не подходит формат данных — проверь slug и поля.';
  }
  return raw;
}
