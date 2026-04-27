'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import BBCodeEditor from '@/components/admin/BBCodeEditor';
import { bbToHtml } from '@/lib/bbcode';

interface ExistingChapter {
  chapter_number: number;
  is_paid: boolean;
}

interface Props {
  novelId: number;
  novelFirebaseId: string;
  suggestedStart: number;    // следующий незанятый номер
  existingChapters: ExistingChapter[];
}

// Парсит BB-текст на части по заголовкам «Глава N» / «Chapter N».
// Терпит BB-обёртки вокруг заголовка: [h]Глава 2[/h], [b]Глава 2[/b],
// [center][b]Глава 2[/b][/center] и т.п. — Word/.docx импорт обычно
// заворачивает заголовки в bold/center/heading.
function splitIntoChapters(
  bbText: string,
  startFallback: number
): Array<{ number: number; bb: string }> {
  const text = bbText.replace(/\r\n/g, '\n');
  // Локальный regex — чтобы lastIndex не утёк между вызовами и matchAll
  // всегда стартовал с начала строки.
  // Структура:
  //   ^[ \t ]*           — отступ (включая NBSP из Word)
  //   (?:\[[^\]\n]+\][ \t ]*)*  — любое количество BB-открывашек
  //   (?:Глава|Chapter)       — само слово
  //   \s*\.?\s*               — опциональная точка/пробелы
  //   (\d+)                   — номер
  //   [^\n]*$                 — хвост строки (закрывающие BB-теги, точки, тире)
  const headerRe =
    /^[ \t ]*(?:\[[^\]\n]+\][ \t ]*)*(?:Глава|Chapter)\s*\.?\s*(\d+)[^\n]*$/gim;
  const matches = [...text.matchAll(headerRe)];

  if (matches.length === 0) {
    const trimmed = text.trim();
    if (!trimmed) return [];
    return [{ number: startFallback, bb: trimmed }];
  }

  const parts: Array<{ number: number; bb: string }> = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const nxt = matches[i + 1];
    const from = (cur.index ?? 0) + cur[0].length;
    const to = nxt ? nxt.index ?? text.length : text.length;
    const chunk = text.slice(from, to).replace(/^\s+/, '').replace(/\s+$/, '');
    if (!chunk) continue;
    const num = parseInt(cur[1], 10);
    if (!isNaN(num)) parts.push({ number: num, bb: chunk });
  }
  return parts;
}

// Парсит «100-104» / «105» / «100 - 110» / «100—104» (em-dash) /
// «100–104» (en-dash) в [start, end]. Возвращает null, если не парсится.
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

export default function BulkChapterUpload({
  novelId,
  novelFirebaseId,
  suggestedStart,
  existingChapters,
}: Props) {
  const router = useRouter();

  const [bbContent, setBbContent] = useState('');
  const [startFrom, setStartFrom] = useState(suggestedStart);
  const [paidFrom, setPaidFrom] = useState<number | ''>('');
  const [defaultPaid, setDefaultPaid] = useState(false);
  const [freeRange, setFreeRange] = useState('');
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Подсказка «открыть следующие N глав бесплатно». Берём 5 последних
  // бесплатных, считаем границу, предлагаем диапазон следующих 5
  // платных. Если ни одной бесплатной — предлагаем «1-5».
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
    // Сколько ещё платных есть впереди? Не предлагаем диапазон шире, чем
    // реально существует — иначе UPDATE ничего не поймает.
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

  // Предпросмотр разбиения новых глав
  const preview = useMemo(() => {
    if (!bbContent.trim()) return [];
    return splitIntoChapters(bbContent, startFrom);
  }, [bbContent, startFrom]);

  // Парсим free-range один раз для UI и сабмита
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

    // Подтверждение действия
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
    const paidFromNum =
      typeof paidFrom === 'number' && paidFrom > 0 ? paidFrom : null;

    try {
      // 1) Загружаем файлы новых глав в storage по очереди.
      //    DB-операции делаем в одном RPC ниже для атомарности
      //    + единого уведомления.
      const chaptersForRpc: Array<{
        num: number;
        content_path: string;
        is_paid: boolean;
      }> = [];

      for (let i = 0; i < preview.length; i++) {
        const p = preview[i];
        setProgress(`Загружаем файл главы ${p.number} (${i + 1}/${preview.length})…`);

        const html = bbToHtml(p.bb);
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

      // 2) Один RPC: записать всё в БД + одно уведомление подписчикам
      //    (мигр. 062). Триггер per-row нотификаций при этом не сработает.
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
      if ((result.new_count ?? 0) > 0) {
        summary.push(`${result.new_count} новых глав`);
      }
      if ((result.freed_count ?? 0) > 0) {
        summary.push(`${result.freed_count} открыто бесплатно`);
      }
      if ((result.notified_users ?? 0) > 0) {
        summary.push(`${result.notified_users} читателей уведомлены`);
      }
      setProgress(summary.length > 0 ? `Готово: ${summary.join(' · ')}` : 'Готово.');
      setBbContent('');
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
      <div className="bulk-instruct">
        <strong>Как подготовить текст</strong>
        <ul>
          <li>Вставь весь текст — одну или сразу все главы.</li>
          <li>
            Начало каждой главы пометь строкой <code>Глава 1</code>,{' '}
            <code>Глава 2</code> и т.д. на отдельной строке. Заголовок
            может быть жирным, по центру или из <code>.docx</code> — это нормально.
          </li>
          <li>Абзацы разделяй пустой строкой. Жирный/курсив — кнопками или BB-кодами.</li>
          <li>Если текст без заголовков — он загрузится как одна глава с номером из поля справа.</li>
          <li>
            Если хочешь только открыть несколько уже загруженных глав
            бесплатно — оставь поле текста пустым и заполни только
            «Открыть бесплатно».
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
      </div>

      {/* Открыть существующие главы бесплатно — отдельный блок,
          с подсказкой «следующие 5» по аналогии с tene. */}
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
        <BBCodeEditor
          value={bbContent}
          onChange={setBbContent}
          minHeight={480}
          placeholder={`Глава 1\n\nТекст первой главы…\n\nГлава 2\n\nТекст второй главы…`}
          hint="Я разберу текст по заголовкам «Глава N» автоматически — даже если они жирные, по центру или импортированы из .docx. Предпросмотр разбиения — справа. Поле можно оставить пустым, если только открываешь бесплатные."
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
              const wordCount = countWords(p.bb);
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

function countWords(bb: string): number {
  const plain = bb
    .replace(/\[[^\]]+\]/g, ' ')
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
