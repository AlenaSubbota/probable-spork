'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import ChapterStats from './ChapterStats';
import DraftBanner from './DraftBanner';

interface GlossaryItem {
  term_original: string;
  term_translation: string;
  category: string | null;
}

interface Props {
  novelId: number;
  novelFirebaseId: string;
  glossary: GlossaryItem[];
  mode: 'create' | 'edit';
  initial?: {
    chapter_number: number;
    content: string;
    is_paid: boolean;
  };
  // Для draft-восстановления (только create):
  draft?: {
    chapter_number: number | null;
    content: string | null;
    is_paid: boolean;
    updated_at: string;
  } | null;
  // Номер следующей главы (подсказка для create)
  suggestedChapterNumber?: number;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function ChapterForm({
  novelId,
  novelFirebaseId,
  glossary,
  mode,
  initial,
  draft,
  suggestedChapterNumber,
}: Props) {
  const router = useRouter();

  const [chapterNumber, setChapterNumber] = useState<number>(
    initial?.chapter_number ?? suggestedChapterNumber ?? 1
  );
  const [content, setContent] = useState<string>(initial?.content ?? '');
  const [isPaid, setIsPaid] = useState<boolean>(initial?.is_paid ?? false);
  const [showPreview, setShowPreview] = useState(true);

  const [draftOffered, setDraftOffered] = useState<boolean>(
    mode === 'create' && !!draft && (draft.content?.length ?? 0) > 0
  );
  const [draftState, setDraftState] = useState<SaveState>('idle');
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveDraftTimerRef = useRef<number | null>(null);

  // ---- Автосохранение черновика (killer #2) — только в режиме create ----
  const saveDraft = useCallback(
    async (nextContent: string, nextChapter: number, nextPaid: boolean) => {
      if (mode !== 'create') return;
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      setDraftState('saving');
      const { error: upErr } = await supabase
        .from('chapter_drafts')
        .upsert(
          {
            user_id: user.id,
            novel_id: novelId,
            chapter_number: nextChapter,
            content: nextContent,
            is_paid: nextPaid,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,novel_id,chapter_number' }
        );
      if (upErr) {
        setDraftState('error');
      } else {
        setDraftState('saved');
        setDraftUpdatedAt(new Date().toISOString());
      }
    },
    [novelId, mode]
  );

  useEffect(() => {
    if (mode !== 'create') return;
    if (!content && chapterNumber === 0) return;
    if (saveDraftTimerRef.current) window.clearTimeout(saveDraftTimerRef.current);
    saveDraftTimerRef.current = window.setTimeout(() => {
      saveDraft(content, chapterNumber, isPaid);
    }, 2000);
    return () => {
      if (saveDraftTimerRef.current) window.clearTimeout(saveDraftTimerRef.current);
    };
  }, [content, chapterNumber, isPaid, saveDraft, mode]);

  // ---- Восстановление черновика ----
  const restoreDraft = () => {
    if (!draft) return;
    if (draft.chapter_number != null) setChapterNumber(draft.chapter_number);
    setContent(draft.content ?? '');
    setIsPaid(!!draft.is_paid);
    setDraftUpdatedAt(draft.updated_at);
    setDraftOffered(false);
  };

  const discardDraft = async () => {
    if (!draft || mode !== 'create') {
      setDraftOffered(false);
      return;
    }
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from('chapter_drafts')
        .delete()
        .eq('user_id', user.id)
        .eq('novel_id', novelId)
        .eq('chapter_number', draft.chapter_number ?? -1);
    }
    setDraftOffered(false);
  };

  // ---- Glossary highlight (killer #1) ----
  // Сортируем термины по длине (длинные вперёд), чтобы не сломать кратким матчем
  const sortedGlossary = useMemo(
    () => [...glossary].sort((a, b) => b.term_original.length - a.term_original.length),
    [glossary]
  );

  const highlightedPreview = useMemo(() => {
    if (!content) return '';
    let html = content;
    for (const g of sortedGlossary) {
      const escaped = g.term_original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(${escaped})`, 'gi');
      html = html.replace(
        regex,
        `<mark class="glossary-match" data-translation="${escapeAttr(g.term_translation)}">$1</mark>`
      );
    }
    return html;
  }, [content, sortedGlossary]);

  const glossaryHitsCount = useMemo(() => {
    if (!content) return 0;
    let total = 0;
    for (const g of sortedGlossary) {
      const escaped = g.term_original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matches = content.match(new RegExp(escaped, 'gi'));
      if (matches) total += matches.length;
    }
    return total;
  }, [content, sortedGlossary]);

  // ---- Toolbar (обёртки тегами) ----
  const contentRef = useRef<HTMLTextAreaElement | null>(null);
  const wrap = (before: string, after: string) => {
    const ta = contentRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = content.slice(start, end) || 'текст';
    const next = content.slice(0, start) + before + selected + after + content.slice(end);
    setContent(next);
    // Выставляем каретку после вставки
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + before.length, start + before.length + selected.length);
    }, 0);
  };

  // ---- Отправка ----
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!chapterNumber || chapterNumber < 1) {
      setError('Номер главы должен быть ≥ 1.');
      return;
    }
    if (!content.trim()) {
      setError('Текст главы пустой.');
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSubmitting(false);
      setError('Нужна авторизация.');
      return;
    }

    // 1. Сохраняем текст в storage
    const filename = `${novelFirebaseId}/${chapterNumber}.html`;
    const blob = new Blob([content], { type: 'text/html; charset=utf-8' });

    const { error: uploadErr } = await supabase.storage
      .from('chapter_content')
      .upload(filename, blob, {
        cacheControl: '3600',
        upsert: true,
        contentType: 'text/html; charset=utf-8',
      });

    if (uploadErr) {
      setError(`Ошибка загрузки текста: ${uploadErr.message}`);
      setSubmitting(false);
      return;
    }

    const nowIso = new Date().toISOString();

    if (mode === 'create') {
      const { error: insertErr } = await supabase.from('chapters').insert({
        novel_id: novelId,
        chapter_number: chapterNumber,
        is_paid: isPaid,
        content_path: filename,
        published_at: nowIso,
      });
      if (insertErr) {
        setError(insertErr.message);
        setSubmitting(false);
        return;
      }
      // Обновляем latest_chapter_published_at в novels
      await supabase
        .from('novels')
        .update({ latest_chapter_published_at: nowIso })
        .eq('id', novelId);

      // Убираем черновик
      await supabase
        .from('chapter_drafts')
        .delete()
        .eq('user_id', user.id)
        .eq('novel_id', novelId)
        .eq('chapter_number', chapterNumber);
    } else {
      const { error: updateErr } = await supabase
        .from('chapters')
        .update({ is_paid: isPaid, content_path: filename })
        .eq('novel_id', novelId)
        .eq('chapter_number', chapterNumber);
      if (updateErr) {
        setError(updateErr.message);
        setSubmitting(false);
        return;
      }
    }

    setSubmitting(false);
    router.push(`/admin/novels/${novelFirebaseId}/edit`);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="chapter-form">
      {draftOffered && draft && (
        <DraftBanner
          updatedAt={draft.updated_at}
          onRestore={restoreDraft}
          onDiscard={discardDraft}
        />
      )}

      <div className="chapter-form-top">
        <div className="form-field" style={{ maxWidth: 140 }}>
          <label>Номер главы</label>
          <input
            type="number"
            min={1}
            className="form-input"
            value={chapterNumber}
            onChange={(e) => setChapterNumber(parseInt(e.target.value, 10) || 0)}
            disabled={mode === 'edit'}
          />
        </div>

        <label className="rs-switch" style={{ height: 64 }}>
          <input
            type="checkbox"
            checked={isPaid}
            onChange={(e) => setIsPaid(e.target.checked)}
          />
          <div>
            <div className="rs-switch-title">Платная глава</div>
            <div className="rs-switch-sub">Только для подписчиков и покупателей</div>
          </div>
        </label>

        <div className="chapter-form-save-state">
          {mode === 'create' && draftState === 'saving' && 'Сохраняем черновик…'}
          {mode === 'create' && draftState === 'saved' && draftUpdatedAt && (
            <>✓ Черновик сохранён</>
          )}
          {mode === 'create' && draftState === 'error' && (
            <span style={{ color: 'var(--rose)' }}>Не удалось сохранить черновик</span>
          )}
        </div>
      </div>

      <div className="chapter-editor">
        <div className="editor-pane">
          <div className="editor-toolbar-row">
            <button type="button" className="chip" onClick={() => wrap('<p>', '</p>')}>
              ¶
            </button>
            <button type="button" className="chip" onClick={() => wrap('<strong>', '</strong>')}>
              <b>B</b>
            </button>
            <button type="button" className="chip" onClick={() => wrap('<em>', '</em>')}>
              <i>I</i>
            </button>
            <button type="button" className="chip" onClick={() => wrap('<h3>', '</h3>')}>
              H
            </button>
            <button type="button" className="chip" onClick={() => wrap('<blockquote>', '</blockquote>')}>
              ❝
            </button>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className={`chip${showPreview ? ' active' : ''}`}
              onClick={() => setShowPreview((s) => !s)}
            >
              Предпросмотр
            </button>
          </div>
          <textarea
            ref={contentRef}
            className="chapter-textarea"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="<p>Глава начинается с абзаца…</p>"
            spellCheck
          />
        </div>

        {showPreview && (
          <div className="editor-pane">
            <div className="editor-preview-head">
              <span>Предпросмотр</span>
              {glossary.length > 0 && (
                <span className="editor-preview-hint">
                  Совпадения с глоссарием: <strong>{glossaryHitsCount}</strong>
                </span>
              )}
            </div>
            <div
              className="editor-preview novel-content"
              dangerouslySetInnerHTML={{ __html: highlightedPreview || '<p><em>Пусто</em></p>' }}
            />
          </div>
        )}
      </div>

      <aside className="chapter-sidebar">
        <ChapterStats content={content} />

        {glossary.length > 0 && (
          <div className="chapter-stats">
            <div className="chapter-stats-head">
              <h3>Глоссарий ({glossary.length})</h3>
            </div>
            <div className="glossary-mini-list">
              {glossary.slice(0, 10).map((g) => (
                <div key={g.term_original} className="glossary-mini-row">
                  <code>{g.term_original}</code>
                  <span>→</span>
                  <span>{g.term_translation}</span>
                </div>
              ))}
              {glossary.length > 10 && (
                <div className="form-hint" style={{ paddingLeft: 0 }}>
                  …и ещё {glossary.length - 10}
                </div>
              )}
            </div>
          </div>
        )}
      </aside>

      {error && (
        <div style={{ color: 'var(--rose)', fontSize: 13, marginTop: 12 }}>{error}</div>
      )}

      <div className="admin-form-footer">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Публикуем…' : mode === 'create' ? 'Опубликовать главу' : 'Сохранить'}
        </button>
      </div>
    </form>
  );
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
