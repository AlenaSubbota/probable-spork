'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import BBCodeEditor from '@/components/admin/BBCodeEditor';
import { bbToHtml } from '@/lib/bbcode';

interface Props {
  novelId: number;
  novelFirebaseId: string;
  suggestedStart: number;    // следующий незанятый номер
}

// Распознаём заголовки «Глава 12» или «Chapter 12» в начале строки / абзаца
const CHAPTER_HEADER_RE = /^\s*\[?(?:Глава|Chapter|Chapter\.?)\s+(\d+)[^\n]*$/gim;

// Парсит BB-текст на части по заголовкам «Глава N»
function splitIntoChapters(
  bbText: string,
  startFallback: number
): Array<{ number: number; bb: string }> {
  const text = bbText.replace(/\r\n/g, '\n');
  const matches = [...text.matchAll(CHAPTER_HEADER_RE)];

  if (matches.length === 0) {
    // Нет заголовков → считаем весь текст одной главой
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

export default function BulkChapterUpload({
  novelId,
  novelFirebaseId,
  suggestedStart,
}: Props) {
  const router = useRouter();

  const [bbContent, setBbContent] = useState('');
  const [startFrom, setStartFrom] = useState(suggestedStart);
  const [paidFrom, setPaidFrom] = useState<number | ''>('');
  const [defaultPaid, setDefaultPaid] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Предпросмотр разбиения — показываем на лету
  const preview = useMemo(() => {
    if (!bbContent.trim()) return [];
    return splitIntoChapters(bbContent, startFrom);
  }, [bbContent, startFrom]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (preview.length === 0) {
      setError('Текст пустой или не удалось распознать главы. Добавь «Глава 1», «Глава 2» и т.д.');
      return;
    }

    const confirmMsg =
      preview.length === 1
        ? `Загрузить 1 главу (№${preview[0].number})?`
        : `Найдено ${preview.length} глав (с ${preview[0].number} по ${preview[preview.length - 1].number}). Загрузить?`;
    if (!window.confirm(confirmMsg)) return;

    setBusy(true);
    setProgress('Начинаем...');

    const supabase = createClient();
    const nowIso = new Date().toISOString();
    const paidFromNum =
      typeof paidFrom === 'number' && paidFrom > 0 ? paidFrom : null;

    try {
      for (let i = 0; i < preview.length; i++) {
        const p = preview[i];
        setProgress(`Глава ${p.number} (${i + 1} / ${preview.length})...`);

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

        const { error: dbErr } = await supabase.from('chapters').upsert(
          {
            novel_id: novelId,
            chapter_number: p.number,
            is_paid: isPaid,
            content_path: filename,
            published_at: nowIso,
          },
          { onConflict: 'novel_id, chapter_number' }
        );
        if (dbErr) throw new Error(`insert ${p.number}: ${dbErr.message}`);
      }

      await supabase
        .from('novels')
        .update({ latest_chapter_published_at: nowIso })
        .eq('id', novelId);

      setProgress(`Готово: ${preview.length} глав опубликовано.`);
      setBbContent('');
      router.refresh();
      setTimeout(() => router.push(`/admin/novels/${novelFirebaseId}/edit`), 1500);
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
          <li>Начало каждой главы пометь строкой <code>Глава 1</code>, <code>Глава 2</code> и т.д. на отдельной строке.</li>
          <li>Абзацы разделяй пустой строкой. Жирный/курсив — кнопками или BB-кодами.</li>
          <li>Если текст без заголовков — он загрузится как одна глава с номером из поля справа.</li>
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

      <div className="form-field">
        <label>Текст всех глав сразу</label>
        <BBCodeEditor
          value={bbContent}
          onChange={setBbContent}
          minHeight={480}
          placeholder={`Глава 1\n\nТекст первой главы…\n\nГлава 2\n\nТекст второй главы…`}
          hint="Я разберу текст по заголовкам «Глава N» автоматически. Предпросмотр разбиения — справа."
        />
      </div>

      <div className="bulk-preview">
        <div className="bulk-preview-head">
          Разбиение ({preview.length} {pluralChapters(preview.length)})
        </div>
        {preview.length === 0 ? (
          <div className="bulk-preview-empty">
            Вставь текст — здесь появится список глав, которые будут созданы.
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
          disabled={busy || preview.length === 0}
        >
          {busy
            ? 'Загружаем…'
            : preview.length === 0
            ? 'Вставь текст'
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
