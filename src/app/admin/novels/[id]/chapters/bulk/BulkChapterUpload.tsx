'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import RichTextEditor from '@/components/admin/RichTextEditor';
import DraftBanner from '@/components/admin/DraftBanner';
import { cleanHtml, materializeFootnotes } from '@/lib/sanitize';
import { bbToHtml } from '@/lib/bbcode';

interface ExistingChapter {
  chapter_number: number;
  is_paid: boolean;
}

interface BulkDraft {
  content: string | null;
  updated_at: string;
}

interface Props {
  novelId: number;
  novelFirebaseId: string;
  suggestedStart: number;    // следующий незанятый номер
  existingChapters: ExistingChapter[];
  // Черновик массовой загрузки. В таблице chapter_drafts резервируем
  // chapter_number = 0 под bulk-форму конкретного юзера на конкретную
  // новеллу.
  draft?: BulkDraft | null;
}

const BULK_DRAFT_CHAPTER_NUMBER = 0;

// Если в драфте лежит legacy BB-код, конвертируем в HTML на load.
function normalizeStoredContent(raw: string): string {
  if (!raw) return '';
  const looksLikeBb = /\[\/?(?:b|i|u|s|h|center|quote|spoiler|fn)\b/i.test(raw);
  const looksLikeHtml = /<\w+[^>]*>/.test(raw);
  if (looksLikeBb && !looksLikeHtml) return bbToHtml(raw);
  return raw;
}

// Парсит HTML на части по заголовкам «Глава N» / «Chapter N».
// Заголовок может быть в любом блочном теге (<p>, <h3>) с любым
// форматированием (strong, em, center). Возвращаем HTML каждой главы.
function splitIntoChapters(
  html: string,
  startFallback: number,
): Array<{ number: number; html: string }> {
  if (typeof window === 'undefined') return [];
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const blocks = Array.from(doc.body.children) as HTMLElement[];
  if (blocks.length === 0) {
    const txt = doc.body.textContent?.trim() ?? '';
    return txt ? [{ number: startFallback, html: html.trim() }] : [];
  }

  const headingRe = /^[ \t ]*(?:Глава|Chapter)\s*\.?\s*(\d+)\b/i;

  const sections: Array<{ number: number; blocks: HTMLElement[] }> = [];
  let current: { number: number; blocks: HTMLElement[] } | null = null;
  const unattached: HTMLElement[] = []; // блоки до первого заголовка

  for (const block of blocks) {
    const text = (block.textContent ?? '').trim();
    const m = headingRe.exec(text);
    if (m) {
      if (current && current.blocks.length > 0) sections.push(current);
      current = { number: parseInt(m[1], 10), blocks: [] };
    } else if (current) {
      current.blocks.push(block);
    } else {
      unattached.push(block);
    }
  }
  if (current && current.blocks.length > 0) sections.push(current);

  // Если заголовков не нашлось — весь текст одной главой по startFallback.
  if (sections.length === 0) {
    if (unattached.length === 0) return [];
    return [
      {
        number: startFallback,
        html: unattached.map((b) => b.outerHTML).join(''),
      },
    ];
  }

  return sections.map((s) => ({
    number: s.number,
    html: s.blocks.map((b) => b.outerHTML).join(''),
  }));
}

// Парсит «100-104» / «105» / «100 - 110» / «100—104» / «100–104»
function parseFreeRange(s: string): { start: number; end: number } | null {
  const clean = s.trim().replace(/[—–]/g, '-');
  if (!clean) return null;
  if (clean.includes('-')) {
    const [a, b] = clean.split('-').map((p) => parseInt(p.trim(), 10));
    if (isNaN(a) || isNaN(b) || a > b) return null;
    return { start: a, end: b };
  }
  const single = parseInt(clean, 10);
  if (isNaN(single)) return null;
  return { start: single, end: single };
}

type DraftState = 'idle' | 'saving' | 'saved' | 'error';

export default function BulkChapterUpload({
  novelId,
  novelFirebaseId,
  suggestedStart,
  existingChapters,
  draft,
}: Props) {
  const router = useRouter();

  const [content, setContent] = useState('');
  const [startFrom, setStartFrom] = useState(suggestedStart);
  const [paidFrom, setPaidFrom] = useState<number | ''>('');
  const [defaultPaid, setDefaultPaid] = useState(false);
  const [freeRange, setFreeRange] = useState('');
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Черновик
  const [draftOffered, setDraftOffered] = useState<boolean>(
    !!draft && (draft.content?.length ?? 0) > 0,
  );
  const [draftState, setDraftState] = useState<DraftState>('idle');
  const saveDraftTimerRef = useRef<number | null>(null);

  const saveDraft = useCallback(
    async (nextContent: string) => {
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
            chapter_number: BULK_DRAFT_CHAPTER_NUMBER,
            content: nextContent,
            is_paid: false,
            price_coins: 10,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,novel_id,chapter_number' },
        );
      if (upErr) setDraftState('error');
      else setDraftState('saved');
    },
    [novelId],
  );

  // Автосейв через 2 секунды после последней правки. Не сохраняем
  // пока пользователь не предпринял действия (содержимое != восстановленное).
  useEffect(() => {
    if (draftOffered) return; // ждём решения по предложенному драфту
    if (!content.trim()) return;
    if (saveDraftTimerRef.current) window.clearTimeout(saveDraftTimerRef.current);
    saveDraftTimerRef.current = window.setTimeout(() => {
      saveDraft(content);
    }, 2000);
    return () => {
      if (saveDraftTimerRef.current) window.clearTimeout(saveDraftTimerRef.current);
    };
  }, [content, draftOffered, saveDraft]);

  const restoreDraft = () => {
    if (!draft?.content) {
      setDraftOffered(false);
      return;
    }
    setContent(normalizeStoredContent(draft.content));
    setDraftOffered(false);
  };

  const discardDraft = async () => {
    setDraftOffered(false);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from('chapter_drafts')
      .delete()
      .eq('user_id', user.id)
      .eq('novel_id', novelId)
      .eq('chapter_number', BULK_DRAFT_CHAPTER_NUMBER);
  };

  // Подсказка «открыть следующие N глав бесплатно».
  const freeSuggestion = useMemo(() => {
    if (existingChapters.length === 0) return null;
    const lastFree = [...existingChapters]
      .filter((c) => !c.is_paid)
      .sort((a, b) => a.chapter_number - b.chapter_number)
      .slice(-5);
    const lastFreeNum =
      lastFree.length > 0
        ? lastFree[lastFree.length - 1].chapter_number
        : 0;
    const paidAhead = existingChapters
      .filter((c) => c.is_paid && c.chapter_number > lastFreeNum)
      .sort((a, b) => a.chapter_number - b.chapter_number)
      .slice(0, 5);
    if (paidAhead.length === 0) return null;
    const start = paidAhead[0].chapter_number;
    const end = paidAhead[paidAhead.length - 1].chapter_number;
    const currentFreeList = lastFree
      .map((c) => c.chapter_number)
      .join(', ');
    const suggested = start === end ? String(start) : `${start}-${end}`;
    return { suggested, currentFreeList };
  }, [existingChapters]);

  // Предпросмотр разбиения
  const preview = useMemo(() => {
    if (!content.trim()) return [];
    return splitIntoChapters(content, startFrom);
  }, [content, startFrom]);

  const parsedFree = useMemo(() => parseFreeRange(freeRange), [freeRange]);

  const hasContent = preview.length > 0;
  const hasFree = parsedFree !== null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!hasContent && !hasFree) {
      setError(
        'Вставь текст ИЛИ укажи диапазон глав для открытия бесплатно (или и то, и другое).'
      );
      return;
    }

    if (freeRange.trim() && !hasFree) {
      setError('Диапазон бесплатных глав непонятен. Пример: 100-104 или 100.');
      return;
    }

    let confirmMsg = '';
    if (hasContent && hasFree) {
      confirmMsg =
        `Загрузить ${preview.length} новых глав ` +
        `(${preview[0].number}–${preview[preview.length - 1].number}) ` +
        `и открыть бесплатно ${parsedFree!.start === parsedFree!.end ? `главу ${parsedFree!.start}` : `главы ${parsedFree!.start}-${parsedFree!.end}`}? ` +
        `Подписчикам прилетит ОДНО уведомление обо всём.`;
    } else if (hasContent) {
      confirmMsg =
        preview.length === 1
          ? `Загрузить 1 главу (№${preview[0].number})?`
          : `Найдено ${preview.length} глав (с ${preview[0].number} по ${preview[preview.length - 1].number}). Загрузить?`;
    } else {
      confirmMsg = `Открыть бесплатно ${parsedFree!.start === parsedFree!.end ? `главу ${parsedFree!.start}` : `главы ${parsedFree!.start}-${parsedFree!.end}`}? Подписчикам прилетит уведомление.`;
    }
    if (!window.confirm(confirmMsg)) return;

    setBusy(true);
    setProgress('Начинаем…');

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError('Нужна авторизация.');
      setBusy(false);
      return;
    }

    const paidFromNum =
      typeof paidFrom === 'number' && paidFrom > 0 ? paidFrom : null;

    try {
      const chaptersForRpc: Array<{
        num: number;
        content_path: string;
        is_paid: boolean;
      }> = [];

      for (let i = 0; i < preview.length; i++) {
        const p = preview[i];
        setProgress(`Загружаем файл главы ${p.number} (${i + 1}/${preview.length})…`);

        const html = cleanHtml(materializeFootnotes(p.html));
        const filename = `${novelFirebaseId}/${p.number}.html`;
        const blob = new Blob([html], { type: 'text/html; charset=utf-8' });

        const { error: upErr } = await supabase.storage
          .from('chapter_content')
          .upload(filename, blob, {
            cacheControl: '3600',
            upsert: true,
            contentType: 'text/html; charset=utf-8',
          });
        if (upErr) throw new Error(`upload ${p.number}: ${upErr.message}`);

        const isPaid =
          paidFromNum !== null ? p.number >= paidFromNum : defaultPaid;

        chaptersForRpc.push({
          num: p.number,
          content_path: filename,
          is_paid: isPaid,
        });
      }

      setProgress('Публикуем и шлём уведомление…');
      const { data, error: rpcErr } = await supabase.rpc(
        'bulk_publish_chapters',
        {
          p_novel_id: novelId,
          p_chapters: chaptersForRpc,
          p_free_range_start: parsedFree?.start ?? null,
          p_free_range_end: parsedFree?.end ?? null,
        }
      );
      if (rpcErr) throw new Error(rpcErr.message);

      const result = (data ?? {}) as {
        new_count?: number;
        freed_count?: number;
        notified_users?: number;
      };

      const summary: string[] = [];
      if ((result.new_count ?? 0) > 0) summary.push(`${result.new_count} новых глав`);
      if ((result.freed_count ?? 0) > 0) summary.push(`${result.freed_count} открыто бесплатно`);
      if ((result.notified_users ?? 0) > 0) summary.push(`${result.notified_users} читателей уведомлены`);

      setProgress(summary.length > 0 ? `Готово: ${summary.join(' · ')}` : 'Готово.');

      // Удаляем bulk-черновик
      await supabase
        .from('chapter_drafts')
        .delete()
        .eq('user_id', user.id)
        .eq('novel_id', novelId)
        .eq('chapter_number', BULK_DRAFT_CHAPTER_NUMBER);

      setContent('');
      setFreeRange('');
      router.refresh();
      setTimeout(
        () => router.push(`/admin/novels/${novelFirebaseId}/edit`),
        2200
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка при загрузке');
      setProgress(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bulk-upload">
      {draftOffered && draft && (
        <DraftBanner
          updatedAt={draft.updated_at}
          onRestore={restoreDraft}
          onDiscard={discardDraft}
        />
      )}

      <div className="bulk-instruct">
        <strong>Как подготовить текст</strong>
        <ul>
          <li>Вставь весь текст — одну или сразу все главы.</li>
          <li>
            Начало каждой главы пометь строкой <code>Глава 1</code>,{' '}
            <code>Глава 2</code> и т.д. на отдельной строке. Заголовок
            может быть жирным, по центру или из <code>.docx</code> — это нормально.
          </li>
          <li>Абзацы разделяй пустой строкой. Жирный/курсив/центр — кнопками тулбара.</li>
          <li>Если текст без заголовков — он загрузится как одна глава с номером из поля справа.</li>
          <li>
            Если хочешь только открыть несколько уже загруженных глав
            бесплатно — оставь поле текста пустым и заполни только
            «Открыть бесплатно».
          </li>
          <li>
            Текст автосохраняется как черновик. Если случайно закроешь
            страницу — я предложу его восстановить при следующем визите.
          </li>
        </ul>
      </div>

      <div className="admin-form-row">
        <div className="form-field">
          <label title="С какого номера начать, если заголовков «Глава N» нет. Обычно = последний номер + 1.">
            Начальный номер
          </label>
          <input
            type="number"
            min={1}
            className="form-input"
            value={startFrom}
            onChange={(e) => setStartFrom(parseInt(e.target.value, 10) || 1)}
          />
        </div>
        <div className="form-field">
          <label title="С какой главы (и далее) делать платной. Пусто — все по умолчанию ниже.">
            С какой главы платные
          </label>
          <input
            type="number"
            min={1}
            className="form-input"
            value={paidFrom}
            onChange={(e) =>
              setPaidFrom(e.target.value ? parseInt(e.target.value, 10) : '')
            }
            placeholder="Например: 10"
          />
        </div>
        <div className="form-field" style={{ alignSelf: 'end' }}>
          <label
            className="rs-switch"
            style={{ height: 38 }}
            title="Если поле «С какой главы платные» пустое — вот базовое значение для всех."
          >
            <input
              type="checkbox"
              checked={defaultPaid}
              onChange={(e) => setDefaultPaid(e.target.checked)}
            />
            <div>
              <div className="rs-switch-title">По умолчанию платные</div>
              <div className="rs-switch-sub">Если не указан диапазон</div>
            </div>
          </label>
        </div>
        <div
          className="chapter-form-save-state"
          style={{ alignSelf: 'end', marginLeft: 'auto', fontSize: 13 }}
        >
          {draftState === 'saving' && 'Сохраняем черновик…'}
          {draftState === 'saved' && '✓ Черновик сохранён'}
          {draftState === 'error' && (
            <span style={{ color: 'var(--rose)' }}>Не удалось сохранить черновик</span>
          )}
        </div>
      </div>

      <div className="bulk-free-block">
        <div className="bulk-free-head">
          <span className="bulk-free-icon" aria-hidden="true">🎁</span>
          <div>
            <div className="bulk-free-title">Открыть бесплатно (диапазон)</div>
            <div className="bulk-free-sub">
              Уже загруженные платные главы можно сразу открыть. Подписчики
              получат это в ТОМ ЖЕ уведомлении, что и новые главы.
            </div>
          </div>
        </div>
        <div className="form-field">
          <label htmlFor="bulk-free-range">Диапазон номеров</label>
          <input
            id="bulk-free-range"
            type="text"
            inputMode="numeric"
            className="form-input"
            value={freeRange}
            onChange={(e) => setFreeRange(e.target.value)}
            placeholder="Например: 100-104 или просто 105"
          />
        </div>
        {freeSuggestion && (
          <div className="bulk-free-hint">
            <strong>Сейчас бесплатные:</strong> {freeSuggestion.currentFreeList || '—'}.
            Открыть следующие:{' '}
            <button
              type="button"
              className="bulk-free-hint-btn"
              onClick={() => setFreeRange(freeSuggestion.suggested)}
            >
              {freeSuggestion.suggested}
            </button>
          </div>
        )}
      </div>

      <div className="form-field">
        <label>Текст всех глав сразу</label>
        <RichTextEditor
          value={content}
          onChange={setContent}
          minHeight={480}
          placeholder="Глава 1 / Текст первой главы… / Глава 2 / Текст второй главы…"
          hint="Я разберу текст по заголовкам «Глава N» автоматически — даже если они жирные, по центру или импортированы из .docx. Поле можно оставить пустым, если только открываешь бесплатные."
        />
      </div>

      <div className="bulk-preview">
        <div className="bulk-preview-head">
          Разбиение ({preview.length} {pluralChapters(preview.length)})
        </div>
        {preview.length === 0 ? (
          <div className="bulk-preview-empty">
            {hasFree
              ? 'Текста нет — будет только открытие бесплатных. Нажми «Запустить» когда готов.'
              : 'Вставь текст — здесь появится список глав, которые будут созданы.'}
          </div>
        ) : (
          <ul className="bulk-preview-list">
            {preview.map((p) => {
              const paid =
                paidFrom !== '' && paidFrom !== null
                  ? p.number >= Number(paidFrom)
                  : defaultPaid;
              const wordCount = countWords(p.html);
              return (
                <li key={p.number} className="bulk-preview-row">
                  <span className="bulk-preview-num">Глава {p.number}</span>
                  <span className="bulk-preview-meta">
                    {wordCount} слов
                  </span>
                  <span
                    className={`tag-price ${paid ? 'paid' : 'free'}`}
                    style={{ fontSize: 11 }}
                  >
                    {paid ? '10 монет' : 'бесплатно'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error && (
        <div style={{ color: 'var(--rose)', fontSize: 13, marginTop: 10 }}>
          {error}
        </div>
      )}

      <div className="admin-form-footer">
        <div style={{ color: 'var(--ink-mute)', fontSize: 13, marginRight: 'auto' }}>
          {progress}
        </div>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || (!hasContent && !hasFree)}
        >
          {busy
            ? 'Работаем…'
            : !hasContent && !hasFree
            ? 'Вставь текст или диапазон'
            : !hasContent && hasFree
            ? `🎁 Открыть бесплатно`
            : hasFree
            ? `🚀 Опубликовать ${preview.length} + открыть ${parsedFree!.start === parsedFree!.end ? '1' : `${parsedFree!.end - parsedFree!.start + 1}`} бесплатно`
            : `🚀 Опубликовать ${preview.length} ${pluralChapters(preview.length)}`}
        </button>
      </div>
    </form>
  );
}

function countWords(html: string): number {
  const plain = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .match(/[\p{L}'-]+/gu);
  return plain ? plain.length : 0;
}

function pluralChapters(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 19) return 'глав';
  if (m10 === 1) return 'главу';
  if (m10 >= 2 && m10 <= 4) return 'главы';
  return 'глав';
}
