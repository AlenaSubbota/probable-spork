'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import CoverUpload from './CoverUpload';
import BBCodeEditor from './BBCodeEditor';
import TranslatorPicker, {
  type TranslatorPickerValue,
} from './TranslatorPicker';
import { bbToHtml, htmlToBb } from '@/lib/bbcode';
import {
  AGE_RATINGS,
  COUNTRY_LABELS,
  PREDEFINED_GENRES,
  TRANSLATION_STATUS_LABELS,
  makeSlug,
  type AgeRating,
  type Country,
  type TranslationStatus,
} from '@/lib/admin';

export interface NovelFormValues {
  id?: number;
  firebase_id?: string;
  title: string;                // русский
  title_original: string | null;
  title_en: string | null;
  author: string | null;            // на русском (как читается)
  author_original: string | null;   // в языке оригинала
  author_en: string | null;         // транслит/английский
  country: Country | null;
  age_rating: AgeRating | null;
  translation_status: TranslationStatus;
  is_completed: boolean;
  release_year: number | null;
  description: string;              // BB-код
  cover_url: string | null;
  genres: string[];
  // Ссылки на оригинал / novelupdates / raws — произвольные пары { label, url }.
  external_links: Array<{ label: string; url: string }>;
  // Путь к EPUB в bucket или полный URL. Показывает кнопку 📘 на странице.
  epub_path: string | null;
  /** Переводчик — либо id зарегистрированного, либо внешний текстом */
  translator: TranslatorPickerValue;
}

const EMPTY: NovelFormValues = {
  title: '',
  title_original: '',
  title_en: '',
  author: '',
  author_original: '',
  author_en: '',
  country: 'kr',
  age_rating: '16+',
  translation_status: 'ongoing',
  is_completed: false,
  release_year: null,
  description: '',
  cover_url: null,
  genres: [],
  external_links: [],
  epub_path: null,
  translator: {
    translator_id: null,
    external_name: null,
    external_url: null,
    external_consent: false,
  },
};

interface Props {
  initial?: Partial<NovelFormValues> & { descriptionHtml?: string };
  mode: 'create' | 'edit';
  isAdmin?: boolean;
  currentUserId?: string | null;
  currentUserName?: string | null;
}

export default function NovelForm({
  initial,
  mode,
  isAdmin = false,
  currentUserId = null,
  currentUserName = null,
}: Props) {
  const router = useRouter();
  const [values, setValues] = useState<NovelFormValues>(() => {
    const merged = { ...EMPTY, ...initial };
    // При редактировании description приходит как HTML — конвертируем в BB
    if (initial?.descriptionHtml) {
      merged.description = htmlToBb(initial.descriptionHtml);
    }
    return merged;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof NovelFormValues>(key: K, v: NovelFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: v }));

  const toggleGenre = (g: string) => {
    set(
      'genres',
      values.genres.includes(g)
        ? values.genres.filter((x) => x !== g)
        : [...values.genres, g]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!values.title.trim()) {
      setError('Укажи название на русском.');
      return;
    }
    if (values.genres.length === 0) {
      setError('Выбери хотя бы один жанр.');
      return;
    }

    // Проверяем выбор переводчика
    const t = values.translator;
    const hasRegistered = !!t.translator_id;
    const externalName = t.external_name?.trim() ?? '';
    const hasExternal = externalName.length > 0;
    if (!hasRegistered && !hasExternal) {
      setError('Выбери переводчика: или зарегистрированного, или укажи внешнего.');
      return;
    }
    if (!hasRegistered && hasExternal && !t.external_consent) {
      setError('Подтверди галочкой, что у тебя есть разрешение переводчика.');
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError('Нужна авторизация.');
      setSubmitting(false);
      return;
    }

    // Описание пишем как готовый HTML (из BB-кода)
    const descriptionHtml = values.description.trim()
      ? bbToHtml(values.description)
      : null;

    // Отфильтруем пустые строки и обрежем пробелы, чтобы в БД не летел мусор.
    const cleanedLinks = (values.external_links ?? [])
      .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
      .filter((l) => l.url.length > 0);

    // translator_id + external_* взаимоисключаются. Если зарегистрированный —
    // сбрасываем внешние поля; если внешний — обнуляем translator_id.
    const payload = {
      title: values.title.trim(),
      title_original: values.title_original?.trim() || null,
      title_en: values.title_en?.trim() || null,
      author: values.author?.trim() || null,
      author_original: values.author_original?.trim() || null,
      author_en: values.author_en?.trim() || null,
      country: values.country,
      age_rating: values.age_rating,
      translation_status: values.translation_status,
      is_completed: values.is_completed,
      release_year: values.release_year,
      description: descriptionHtml,
      cover_url: values.cover_url,
      genres: values.genres,
      external_links: cleanedLinks.length > 0 ? cleanedLinks : null,
      epub_path: values.epub_path?.trim() ? values.epub_path.trim() : null,
      translator_id: hasRegistered ? t.translator_id : null,
      external_translator_name: hasRegistered ? null : externalName,
      external_translator_url: hasRegistered
        ? null
        : t.external_url?.trim() || null,
    };

    if (mode === 'create') {
      const firebase_id = makeSlug(values.title);
      // Админ сразу публикует. Переводчик — в draft, потом отдельно жмёт
      // «отправить на модерацию». До одобрения читатели новеллу не видят.
      const { data, error: insertError } = await supabase
        .from('novels')
        .insert({
          firebase_id,
          ...payload,
          moderation_status: isAdmin ? 'published' : 'draft',
        })
        .select('firebase_id')
        .single();

      if (insertError) {
        setError(insertError.message);
        setSubmitting(false);
        return;
      }
      router.push(`/admin/novels/${data.firebase_id}/edit`);
      router.refresh();
    } else {
      const { error: updateError } = await supabase
        .from('novels')
        .update(payload)
        .eq('id', values.id!);

      if (updateError) {
        setError(updateError.message);
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
      router.refresh();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="admin-form">
      <div className="admin-form-grid">
        <CoverUpload
          value={values.cover_url}
          onChange={(v) => set('cover_url', v)}
        />

        <div className="admin-form-fields">
          <div className="form-field">
            <label title="Главное название новеллы на русском языке. Его увидят читатели в каталоге.">
              Название на русском *
            </label>
            <input
              className="form-input"
              value={values.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="Например: Лунные песни осеннего двора"
              required
              title="Обязательное поле"
            />
          </div>
          <div className="form-field">
            <label title="Название на языке оригинала: кириллица→латиница, иероглифы. Показывается в карточке как «оригинал / английский / русский».">
              Название на языке оригинала
            </label>
            <input
              className="form-input"
              value={values.title_original ?? ''}
              onChange={(e) => set('title_original', e.target.value)}
              placeholder="秋天月庭的歌 / 가을달 정원의 노래"
            />
          </div>
          <div className="form-field">
            <label title="Английская версия названия — часто ею удобнее гуглить оригинал.">
              Название на английском
            </label>
            <input
              className="form-input"
              value={values.title_en ?? ''}
              onChange={(e) => set('title_en', e.target.value)}
              placeholder="Например: Moonlit Songs of the Autumn Court"
            />
          </div>

          <div className="form-row-3">
            <div className="form-field">
              <label title="Имя автора в языке оригинала (иероглифы/корейский/японский).">
                Автор (оригинал)
              </label>
              <input
                className="form-input"
                value={values.author_original ?? ''}
                onChange={(e) => set('author_original', e.target.value)}
                placeholder="黑猫"
              />
            </div>
            <div className="form-field">
              <label title="Английский/транслит автора — удобно для поиска первоисточника.">
                Автор (английский)
              </label>
              <input
                className="form-input"
                value={values.author_en ?? ''}
                onChange={(e) => set('author_en', e.target.value)}
                placeholder="Black Cat"
              />
            </div>
            <div className="form-field">
              <label title="Как имя автора произносится на русском — для читателей.">
                Автор (русский)
              </label>
              <input
                className="form-input"
                value={values.author ?? ''}
                onChange={(e) => set('author', e.target.value)}
                placeholder="Блэк Кэт"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="admin-form-row">
        <div className="form-field">
          <label title="Страна, откуда родом оригинал новеллы.">Страна оригинала</label>
          <select
            className="form-input"
            value={values.country ?? ''}
            onChange={(e) => set('country', (e.target.value || null) as Country | null)}
          >
            {(Object.entries(COUNTRY_LABELS) as [Country, string][]).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label title="Возрастной рейтинг: чтобы читатели видели, кому подходит.">
            Возрастное ограничение
          </label>
          <select
            className="form-input"
            value={values.age_rating ?? ''}
            onChange={(e) => set('age_rating', (e.target.value || null) as AgeRating | null)}
          >
            <option value="">—</option>
            {AGE_RATINGS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label title="Год публикации оригинала (не перевода).">Год оригинала</label>
          <input
            className="form-input"
            type="number"
            min={1900}
            max={2100}
            value={values.release_year ?? ''}
            onChange={(e) =>
              set('release_year', e.target.value ? parseInt(e.target.value, 10) : null)
            }
          />
        </div>
      </div>

      <div className="admin-form-row">
        <div className="form-field">
          <label title="В каком состоянии сейчас твой перевод (не оригинал).">
            Статус перевода
          </label>
          <select
            className="form-input"
            value={values.translation_status}
            onChange={(e) => set('translation_status', e.target.value as TranslationStatus)}
          >
            {(Object.entries(TRANSLATION_STATUS_LABELS) as [TranslationStatus, string][]).map(
              ([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              )
            )}
          </select>
        </div>
        <div className="form-field" style={{ alignSelf: 'end' }}>
          <label
            className="rs-switch"
            style={{ height: 38 }}
            title="Автор оригинала дописал до конца. К твоему переводу это не относится."
          >
            <input
              type="checkbox"
              checked={values.is_completed}
              onChange={(e) => set('is_completed', e.target.checked)}
            />
            <div>
              <div className="rs-switch-title">Оригинал завершён</div>
              <div className="rs-switch-sub">Автор дописал до финала</div>
            </div>
          </label>
        </div>
      </div>

      <div className="form-field">
        <label title="Кто перевёл эту новеллу. Если он зарегистрирован у нас — выбери из списка. Если нет — укажи как внешнего переводчика (нужна галочка, что у тебя есть разрешение).">
          Переводчик *
        </label>
        <TranslatorPicker
          value={values.translator}
          onChange={(v) => set('translator', v)}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
        />
      </div>

      <div className="form-field">
        <label title="Выбери подходящие жанры. Выберешь точнее — алгоритм лучше рекомендует новеллу читателям.">
          Жанры * <span className="form-label-sub">(минимум 1; возраст — отдельным полем выше)</span>
        </label>
        <div className="filter-pills">
          {PREDEFINED_GENRES.map((g) => (
            <button
              key={g}
              type="button"
              className={`filter-pill${values.genres.includes(g) ? ' active' : ''}`}
              onClick={() => toggleGenre(g)}
            >
              {g}
            </button>
          ))}
        </div>
        <div className="form-hint">
          Список фиксированный: нужно, чтобы одинаковые истории попадали в одну категорию и находили своих читателей.
        </div>
      </div>

      <div className="form-field">
        <label title="Описание для карточки новеллы — коротко о сюжете, без спойлеров. Для выделения используй кнопки над полем.">
          Описание
        </label>
        <BBCodeEditor
          value={values.description}
          onChange={(v) => set('description', v)}
          placeholder="Расскажи о сюжете в 2–4 абзацах. Не пиши спойлеры — это презентация для нового читателя."
          minHeight={200}
          hint="Кнопки сверху расставят нужные теги автоматически. [b]жирный[/b], [i]курсив[/i], [quote]цитата[/quote], [spoiler]скрытый текст[/spoiler]."
        />
      </div>

      <div className="form-field">
        <label title="Ссылки на оригинал: novelupdates, raws, авторский сайт, профиль автора. Необязательно.">
          Ссылки на оригинал
        </label>
        <div className="external-links-editor">
          {values.external_links.map((link, i) => (
            <div key={i} className="external-link-row">
              <input
                className="form-input"
                placeholder="Название (NovelUpdates / RAW / Автор)"
                value={link.label}
                onChange={(e) => {
                  const next = [...values.external_links];
                  next[i] = { ...next[i], label: e.target.value };
                  set('external_links', next);
                }}
              />
              <input
                className="form-input"
                type="url"
                placeholder="https://…"
                value={link.url}
                onChange={(e) => {
                  const next = [...values.external_links];
                  next[i] = { ...next[i], url: e.target.value };
                  set('external_links', next);
                }}
              />
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  const next = values.external_links.filter((_, idx) => idx !== i);
                  set('external_links', next);
                }}
                aria-label="Убрать ссылку"
                title="Убрать ссылку"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() =>
              set('external_links', [...values.external_links, { label: '', url: '' }])
            }
          >
            + Добавить ссылку
          </button>
        </div>
        <p className="form-hint">
          Эти ссылки появятся на карточке новеллы блоком «Оригинал» —
          читатели смогут пойти к автору.
        </p>
      </div>

      <div className="form-field">
        <label title="Ссылка или путь к готовому EPUB. Можно положить файл в bucket 'epub' и указать относительный путь, или вставить полный URL.">
          EPUB (для офлайн-чтения)
        </label>
        <input
          className="form-input"
          value={values.epub_path ?? ''}
          onChange={(e) => set('epub_path', e.target.value || null)}
          placeholder="https://… или novels/my-novel.epub"
        />
        <p className="form-hint">
          Если заполнено — на странице новеллы появится кнопка
          «📘 EPUB». Читатели смогут скачать и читать офлайн.
        </p>
      </div>

      {error && (
        <div style={{ color: 'var(--rose)', fontSize: 13, marginBottom: 12 }}>{error}</div>
      )}

      <div className="admin-form-footer">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Сохраняем…' : mode === 'create' ? 'Создать новеллу' : 'Сохранить'}
        </button>
      </div>
    </form>
  );
}
