'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import BBCodeEditor from './BBCodeEditor';
import { bbToHtml, htmlToBb } from '@/lib/bbcode';
import {
  NEWS_TYPES,
  isJournalType,
  type NewsType,
} from '@/lib/news';

export interface NewsFormValues {
  id?: number;
  title: string;
  subtitle: string;
  body: string;       // BB-код (конвертируется в HTML при submit)
  type: NewsType;
  cover_url: string;
  rubrics: string[];
  is_pinned: boolean;
  is_published: boolean;
  attached_novel_id: number | null;
}

interface Props {
  initial?: Partial<NewsFormValues> & { bodyHtml?: string };
  mode: 'create' | 'edit';
}

const EMPTY: NewsFormValues = {
  title: '',
  subtitle: '',
  body: '',
  type: 'announcement',
  cover_url: '',
  rubrics: [],
  is_pinned: false,
  is_published: true,
  attached_novel_id: null,
};

// Лёгкий автокомплит для поля «прикрепить новеллу»
interface NovelOption {
  id: number;
  title: string;
  firebase_id: string;
}

export default function NewsForm({ initial, mode }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<NewsFormValues>(() => {
    const merged = { ...EMPTY, ...initial };
    if (initial?.bodyHtml) merged.body = htmlToBb(initial.bodyHtml);
    return merged;
  });
  const [novelQuery, setNovelQuery] = useState('');
  const [novelOptions, setNovelOptions] = useState<NovelOption[]>([]);
  const [attachedNovel, setAttachedNovel] = useState<NovelOption | null>(null);
  const [rubricInput, setRubricInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isJournal = isJournalType(values.type);

  const addRubric = () => {
    const v = rubricInput.trim();
    if (!v) return;
    if (values.rubrics.includes(v)) {
      setRubricInput('');
      return;
    }
    setValues((p) => ({ ...p, rubrics: [...p.rubrics, v].slice(0, 6) }));
    setRubricInput('');
  };
  const removeRubric = (r: string) =>
    setValues((p) => ({ ...p, rubrics: p.rubrics.filter((x) => x !== r) }));

  // Подтягиваем подгруженную новеллу при редактировании
  useEffect(() => {
    if (!values.attached_novel_id || attachedNovel) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('novels')
        .select('id, title, firebase_id')
        .eq('id', values.attached_novel_id)
        .maybeSingle();
      if (!cancelled && data) setAttachedNovel(data);
    })();
    return () => { cancelled = true; };
  }, [values.attached_novel_id, attachedNovel]);

  // Поиск новелл для прикрепления
  useEffect(() => {
    if (!novelQuery || novelQuery.length < 2) {
      setNovelOptions([]);
      return;
    }
    const handle = window.setTimeout(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('novels')
        .select('id, title, firebase_id')
        .ilike('title', `%${novelQuery.replace(/[%_]/g, '\\$&')}%`)
        .limit(8);
      setNovelOptions(data ?? []);
    }, 200);
    return () => window.clearTimeout(handle);
  }, [novelQuery]);

  const set = <K extends keyof NewsFormValues>(k: K, v: NewsFormValues[K]) =>
    setValues((p) => ({ ...p, [k]: v }));

  const pickNovel = (n: NovelOption | null) => {
    setAttachedNovel(n);
    set('attached_novel_id', n?.id ?? null);
    setNovelQuery('');
    setNovelOptions([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!values.title.trim()) {
      setError('Укажи заголовок.');
      return;
    }
    if (!values.body.trim()) {
      setError('Напиши текст новости.');
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

    const bodyHtml = bbToHtml(values.body);
    const payload = {
      title: values.title.trim(),
      subtitle: isJournal ? (values.subtitle.trim() || null) : null,
      body: bodyHtml,
      type: values.type,
      cover_url: isJournal ? (values.cover_url.trim() || null) : null,
      rubrics: isJournal ? values.rubrics : [],
      is_pinned: values.is_pinned,
      is_published: values.is_published,
      attached_novel_id: values.attached_novel_id,
    };

    if (mode === 'create') {
      const { data, error: insErr } = await supabase
        .from('news_posts')
        .insert({ ...payload, author_id: user.id })
        .select('id')
        .single();
      if (insErr) {
        setError(insErr.message);
        setSubmitting(false);
        return;
      }
      router.push(`/admin/news`);
      router.refresh();
    } else {
      const { error: upErr } = await supabase
        .from('news_posts')
        .update(payload)
        .eq('id', values.id!);
      if (upErr) {
        setError(upErr.message);
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
      router.refresh();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="admin-form">
      <div className="form-field">
        <label title="Краткий заголовок новости. Отображается в шапке карточки и в ленте.">
          Заголовок *
        </label>
        <input
          className="form-input"
          value={values.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Например: Запустили вторую новеллу!"
          maxLength={200}
          required
        />
      </div>

      <div className="admin-form-row">
        <div className="form-field">
          <label title="Категория новости — определяет эмодзи и цвет карточки.">
            Тип
          </label>
          <select
            className="form-input"
            value={values.type}
            onChange={(e) => set('type', e.target.value as NewsType)}
          >
            {NEWS_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.emoji} {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="form-field" style={{ alignSelf: 'end' }}>
          <label
            className="rs-switch"
            style={{ height: 38 }}
            title="Закреплённая новость всплывает наверху ленты, даже если есть свежие."
          >
            <input
              type="checkbox"
              checked={values.is_pinned}
              onChange={(e) => set('is_pinned', e.target.checked)}
            />
            <div>
              <div className="rs-switch-title">Закрепить</div>
              <div className="rs-switch-sub">Будет всплывать вверху</div>
            </div>
          </label>
        </div>

        <div className="form-field" style={{ alignSelf: 'end' }}>
          <label
            className="rs-switch"
            style={{ height: 38 }}
            title="Если выключено — новость сохранится как черновик, читатели её не увидят."
          >
            <input
              type="checkbox"
              checked={values.is_published}
              onChange={(e) => set('is_published', e.target.checked)}
            />
            <div>
              <div className="rs-switch-title">Опубликовать</div>
              <div className="rs-switch-sub">Иначе — черновик</div>
            </div>
          </label>
        </div>
      </div>

      {isJournal && (
        <>
          <div className="form-field">
            <label title="Подзаголовок для статьи/обзора. Краткая подводка из 1–2 предложений — показывается в карточке на главной и под заголовком на странице материала.">
              Подзаголовок
            </label>
            <textarea
              className="form-input"
              rows={2}
              value={values.subtitle}
              onChange={(e) => set('subtitle', e.target.value)}
              placeholder="О чём материал — в одну-две строки."
              maxLength={400}
            />
          </div>

          <div className="form-field">
            <label title="Обложка статьи: URL или относительный путь (например, covers/article-42.webp). Используется на главной в слайдере «Журнал».">
              Обложка
            </label>
            <input
              className="form-input"
              value={values.cover_url}
              onChange={(e) => set('cover_url', e.target.value)}
              placeholder="https://… или covers/article-42.webp"
            />
            {values.cover_url && (
              <div
                style={{
                  marginTop: 8,
                  aspectRatio: '16 / 10',
                  maxWidth: 260,
                  borderRadius: 12,
                  overflow: 'hidden',
                  background: 'var(--surface-2)',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={values.cover_url}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </div>
            )}
          </div>

          <div className="form-field">
            <label title="Теги-рубрики, как у Литреса: «фэнтези», «интервью», «тренды». До 6 штук. Enter, чтобы добавить.">
              Рубрики
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {values.rubrics.map((r) => (
                <button
                  key={r}
                  type="button"
                  className="journal-rubric"
                  style={{ cursor: 'pointer', background: 'var(--accent-wash)', color: 'var(--accent-hover)' }}
                  onClick={() => removeRubric(r)}
                  title="Убрать"
                >
                  {r} ×
                </button>
              ))}
            </div>
            <input
              className="form-input"
              value={rubricInput}
              onChange={(e) => setRubricInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addRubric();
                }
              }}
              placeholder="Добавь рубрику и нажми Enter"
              disabled={values.rubrics.length >= 6}
            />
          </div>
        </>
      )}

      <div className="form-field">
        <label title="Опционально: прикрепи к новости новеллу — появится карточка с обложкой и кнопкой «открыть».">
          Прикрепить новеллу
        </label>
        {attachedNovel ? (
          <div
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              padding: '10px 14px',
              background: 'var(--accent-wash)',
              border: '1px solid var(--accent-soft)',
              borderRadius: 10,
            }}
          >
            <span style={{ flex: 1, fontWeight: 600 }}>{attachedNovel.title}</span>
            <code style={{ background: 'var(--bg-soft)', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>
              {attachedNovel.firebase_id}
            </code>
            <button type="button" className="btn btn-ghost" onClick={() => pickNovel(null)}>
              Убрать
            </button>
          </div>
        ) : (
          <>
            <input
              className="form-input"
              value={novelQuery}
              onChange={(e) => setNovelQuery(e.target.value)}
              placeholder="Начни писать название — появятся варианты"
            />
            {novelOptions.length > 0 && (
              <div
                style={{
                  marginTop: 4,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  maxHeight: 220,
                  overflowY: 'auto',
                }}
              >
                {novelOptions.map((n) => (
                  <button
                    type="button"
                    key={n.id}
                    onClick={() => pickNovel(n)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 12px',
                      background: 'transparent',
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--border)',
                      fontSize: 13.5,
                    }}
                  >
                    {n.title}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="form-field">
        <label title="Основной текст новости. Для выделения пользуйся кнопками — теги расставятся автоматически.">
          Текст
        </label>
        <BBCodeEditor
          value={values.body}
          onChange={(v) => set('body', v)}
          placeholder="Расскажи подробности. Можно использовать BB-коды для выделения."
          minHeight={240}
          hint="[b]жирный[/b] · [i]курсив[/i] · [quote]цитата[/quote] · [spoiler]скрытый текст[/spoiler]"
        />
      </div>

      {error && (
        <div style={{ color: 'var(--rose)', fontSize: 13, marginBottom: 12 }}>{error}</div>
      )}

      <div className="admin-form-footer">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Сохраняем…' : mode === 'create' ? 'Опубликовать' : 'Сохранить'}
        </button>
      </div>
    </form>
  );
}
