'use client';

import { useEffect, useRef, useState } from 'react';
import { bbToHtml } from '@/lib/bbcode';
import { docxToBb, htmlClipboardToBb } from '@/lib/docx';

interface Props {
  value: string;               // BB-код (сохраняется как есть)
  onChange: (bb: string) => void;
  placeholder?: string;
  rows?: number;
  minHeight?: number;
  hint?: string;
}

const BUTTONS: Array<{ tag: string; label: string; title: string; block?: boolean }> = [
  { tag: 'b',       label: 'B',  title: 'Жирный (Ctrl+B)' },
  { tag: 'i',       label: 'I',  title: 'Курсив (Ctrl+I)' },
  { tag: 'u',       label: 'U',  title: 'Подчёркнутый' },
  { tag: 's',       label: 'S',  title: 'Зачёркнутый' },
  { tag: 'h',       label: 'H',  title: 'Заголовок', block: true },
  { tag: 'quote',   label: '❝',  title: 'Цитата', block: true },
  { tag: 'center',  label: '⇔',  title: 'По центру', block: true },
  { tag: 'spoiler', label: '🙈', title: 'Спойлер (скрытый блок)', block: true },
];

// Редактор с BB-кодами: переводчик жмёт кнопку — в текст вставляются теги.
// Плюс живой предпросмотр справа.
export default function BBCodeEditor({
  value,
  onChange,
  placeholder,
  rows = 6,
  minHeight = 160,
  hint,
}: Props) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Поповер для сноски: подцеплен к кнопке ⓘ. Сноска вставляется
  // в позицию курсора как [fn]пояснение[/fn]. Запоминаем место курсора
  // на момент открытия — пока пишут пояснение, фокус уйдёт на textarea
  // поповера, а нам надо вернуть его в исходную точку.
  const [fnOpen, setFnOpen] = useState(false);
  const [fnText, setFnText] = useState('');
  const fnSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const fnInputRef = useRef<HTMLTextAreaElement | null>(null);

  const wrap = (tag: string, block = false) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = value.slice(start, end) || 'текст';
    const open = `[${tag}]`;
    const close = `[/${tag}]`;
    const insertion =
      block && selected && !selected.startsWith('\n')
        ? `\n${open}${selected}${close}\n`
        : `${open}${selected}${close}`;
    const next = value.slice(0, start) + insertion + value.slice(end);
    onChange(next);
    setTimeout(() => {
      ta.focus();
      const cursorStart = start + open.length + (block ? 1 : 0);
      ta.setSelectionRange(cursorStart, cursorStart + selected.length);
    }, 0);
  };

  const openFootnote = () => {
    const ta = taRef.current;
    if (!ta) return;
    fnSelectionRef.current = { start: ta.selectionStart, end: ta.selectionEnd };
    setFnText('');
    setFnOpen(true);
  };

  const closeFootnote = () => {
    setFnOpen(false);
    setFnText('');
    // Возвращаем фокус в основное поле, чтобы пользователь мог продолжить печатать
    setTimeout(() => taRef.current?.focus(), 0);
  };

  const insertFootnote = () => {
    const trimmed = fnText.trim();
    if (!trimmed) return;
    const sel = fnSelectionRef.current;
    const ta = taRef.current;
    if (!sel || !ta) return;
    const tag = `[fn]${trimmed}[/fn]`;
    const next = value.slice(0, sel.start) + tag + value.slice(sel.end);
    onChange(next);
    setFnOpen(false);
    setFnText('');
    setTimeout(() => {
      ta.focus();
      const pos = sel.start + tag.length;
      ta.setSelectionRange(pos, pos);
    }, 0);
  };

  // Автофокус в поповере при открытии
  useEffect(() => {
    if (fnOpen) {
      setTimeout(() => fnInputRef.current?.focus(), 0);
    }
  }, [fnOpen]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      wrap('b');
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      wrap('i');
    } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openFootnote();
    }
  };

  const onFnKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeFootnote();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      insertFootnote();
    }
  };

  // Перехватываем вставку из Word/Google Docs/Pages: если в clipboard есть
  // text/html — конвертируем его в BB, чтобы курсив и центрирование не
  // пропали (textarea сам по себе принимает только plain text).
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const html = e.clipboardData.getData('text/html');
    if (!html) return; // обычный plain-text paste — пусть браузер сам
    const bb = htmlClipboardToBb(html);
    if (!bb) return;
    e.preventDefault();
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = value.slice(0, start) + bb + value.slice(end);
    onChange(next);
    setTimeout(() => {
      ta.focus();
      const pos = start + bb.length;
      ta.setSelectionRange(pos, pos);
    }, 0);
  };

  const triggerDocxUpload = () => {
    setImportError(null);
    fileInputRef.current?.click();
  };

  const onDocxSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Сбрасываем input сразу, чтобы тот же файл можно было выбрать повторно
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    setImportError(null);
    try {
      const bb = await docxToBb(file);
      if (!bb.trim()) {
        setImportError('В документе не нашлось текста.');
        return;
      }
      const ta = taRef.current;
      if (!value.trim()) {
        onChange(bb);
        setTimeout(() => {
          ta?.focus();
          ta?.setSelectionRange(bb.length, bb.length);
        }, 0);
        return;
      }
      const replace = window.confirm(
        'В редакторе уже есть текст. Заменить его содержимым файла?\n\n' +
          'OK — заменить, Отмена — вставить в позицию курсора.',
      );
      if (replace) {
        onChange(bb);
        setTimeout(() => {
          ta?.focus();
          ta?.setSelectionRange(bb.length, bb.length);
        }, 0);
      } else if (ta) {
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const next = value.slice(0, start) + bb + value.slice(end);
        onChange(next);
        setTimeout(() => {
          ta.focus();
          const pos = start + bb.length;
          ta.setSelectionRange(pos, pos);
        }, 0);
      } else {
        onChange(value + '\n\n' + bb);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setImportError(`Не удалось прочитать .docx: ${msg}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="bbcode-editor">
      <div className="bbcode-toolbar">
        {BUTTONS.map((b) => (
          <button
            key={b.tag}
            type="button"
            className="bbcode-btn"
            onClick={() => wrap(b.tag, b.block)}
            title={b.title}
          >
            {b.label}
          </button>
        ))}
        <button
          type="button"
          className="bbcode-btn"
          onClick={openFootnote}
          title="Сноска переводчика (Ctrl+Shift+F)"
        >
          ⓘ
        </button>
        <button
          type="button"
          className="bbcode-btn"
          onClick={triggerDocxUpload}
          title="Загрузить .docx — курсив и центрирование сохранятся"
          disabled={importing}
        >
          {importing ? '…' : '📄 .docx'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={onDocxSelected}
          style={{ display: 'none' }}
        />
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className={`bbcode-btn${showPreview ? ' active' : ''}`}
          onClick={() => setShowPreview((s) => !s)}
          title="Показать/скрыть предпросмотр"
        >
          Предпросмотр
        </button>
      </div>

      {importError && (
        <div className="form-hint" style={{ color: 'var(--rose)' }}>
          {importError}
        </div>
      )}

      {fnOpen && (
        <div className="bbcode-fn-popover">
          <div className="bbcode-fn-label">
            Текст сноски — то, что увидит читатель под абзацем
          </div>
          <textarea
            ref={fnInputRef}
            className="bbcode-fn-input"
            value={fnText}
            onChange={(e) => setFnText(e.target.value)}
            onKeyDown={onFnKeyDown}
            rows={3}
            placeholder="신병 — синбён: в корейском шаманизме состояние…"
          />
          <div className="bbcode-fn-actions">
            <button type="button" className="btn btn-ghost" onClick={closeFootnote}>
              Отмена
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={insertFootnote}
              disabled={!fnText.trim()}
            >
              Вставить (Ctrl+Enter)
            </button>
          </div>
        </div>
      )}

      <div className={`bbcode-body${showPreview ? ' with-preview' : ''}`}>
        <textarea
          ref={taRef}
          className="bbcode-textarea"
          style={{ minHeight }}
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={placeholder ?? 'Пиши обычным текстом. Для выделения — кнопки выше или BB-коды: [b]жирный[/b]'}
        />
        {showPreview && (
          <div
            className="bbcode-preview novel-content"
            dangerouslySetInnerHTML={{ __html: bbToHtml(value) || '<p><em>Предпросмотр появится здесь</em></p>' }}
          />
        )}
      </div>

      {hint && <div className="form-hint">{hint}</div>}
    </div>
  );
}
