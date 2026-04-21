'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import ChapterStats from './ChapterStats';
import DraftBanner from './DraftBanner';
import BBCodeEditor from './BBCodeEditor';
import { bbToHtml, htmlToBb } from '@/lib/bbcode';

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
    price_coins?: number;
  };
  // Для draft-восстановления (только create):
  draft?: {
    chapter_number: number | null;
    content: string | null;
    is_paid: boolean;
    price_coins?: number | null;
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
  // В форме храним BB-коды. Если пришёл HTML из storage при edit — конвертируем.
  const [content, setContent] = useState<string>(() => {
    const raw = initial?.content ?? '';
    if (!raw) return '';
    return /<\w+/.test(raw) ? htmlToBb(raw) : raw;
  });
  const [isPaid, setIsPaid] = useState<boolean>(initial?.is_paid ?? false);
  const [priceCoins, setPriceCoins] = useState<number>(
    initial?.price_coins ?? 10
  );

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
    async (
      nextContent: string,
      nextChapter: number,
      nextPaid: boolean,
      nextPrice: number
    ) => {
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
            price_coins: nextPrice,
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
      saveDraft(content, chapterNumber, isPaid, priceCoins);
    }, 2000);
    return () => {
      if (saveDraftTimerRef.current) window.clearTimeout(saveDraftTimerRef.current);
    };
  }, [content, chapterNumber, isPaid, priceCoins, saveDraft, mode]);

  // ---- Восстановление черновика ----
  const restoreDraft = () => {
    if (!draft) return;
    if (draft.chapter_number != null) setChapterNumber(draft.chapter_number);
    setContent(draft.content ?? '');
    setIsPaid(!!draft.is_paid);
    if (draft.price_coins != null) setPriceCoins(draft.price_coins);
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

  // HTML-версия контента для стат, превью и сохранения
  const contentHtml = useMemo(() => bbToHtml(content), [content]);

  // ---- Glossary highlight (killer #1) ----
  // Подсвечиваем совпадения в HTML-превью.
  const sortedGlossary = useMemo(
    () => [...glossary].sort((a, b) => b.term_original.length - a.term_original.length),
    [glossary]
  );

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

    // 1. Сохраняем текст в storage (BB → HTML на лету)
    const filename = `${novelFirebaseId}/${chapterNumber}.html`;
    const blob = new Blob([contentHtml], { type: 'text/html; charset=utf-8' });

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
        price_coins: isPaid ? priceCoins : 10,
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
        .update({
          is_paid: isPaid,
          price_coins: isPaid ? priceCoins : 10,
          content_path: filename,
        })
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

        {isPaid && (
          <div className="form-field" style={{ maxWidth: 140 }}>
            <label title="Сколько монет стоит разовая покупка этой главы. От 1 до 500. Подписчики переводчика читают бесплатно независимо от цены.">
              Цена, монет
            </label>
            <input
              type="number"
              className="form-input"
              min={1}
              max={500}
              step={1}
              value={priceCoins}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setPriceCoins(Number.isFinite(v) ? Math.max(1, Math.min(500, v)) : 10);
              }}
            />
          </div>
        )}

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
        {glossary.length > 0 && (
          <div className="form-hint" style={{ marginBottom: 6 }}>
            Совпадений с глоссарием в тексте: <strong>{glossaryHitsCount}</strong>
          </div>
        )}
        <BBCodeEditor
          value={content}
          onChange={setContent}
          rows={20}
          minHeight={480}
          placeholder="Абзацы разделяй пустой строкой. Для выделения — кнопки выше или BB-коды."
          hint="Кнопки расставят теги автоматически. Не нужно ничего знать про HTML — пиши как обычный текст."
        />
      </div>

      <aside className="chapter-sidebar">
        <ChapterStats content={contentHtml} />

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

