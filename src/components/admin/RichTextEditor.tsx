'use client';

import { useEffect, useRef, useState } from 'react';
import { cleanHtml } from '@/lib/sanitize';
import { docxToHtml, htmlClipboardToHtml } from '@/lib/docx';

interface Props {
  // HTML — то что хранится в storage. На initial mount устанавливаем
  // в innerHTML; программные обновления (импорт .docx, восстановление
  // черновика) тоже тригерят перезапись DOM.
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  // Если контент перерастает maxHeight — внутренний скролл, не растим
  // окно бесконечно. По умолчанию 600px.
  maxHeight?: number;
  hint?: string;
}

interface ToolbarBtn {
  cmd: string;
  arg?: string;
  label: string;
  title: string;
}

const TOOLBAR: ToolbarBtn[] = [
  { cmd: 'bold',         label: 'B', title: 'Жирный (Ctrl+B)' },
  { cmd: 'italic',       label: 'I', title: 'Курсив (Ctrl+I)' },
  { cmd: 'underline',    label: 'U', title: 'Подчёркнутый (Ctrl+U)' },
  { cmd: 'strikeThrough',label: 'S', title: 'Зачёркнутый' },
  { cmd: 'formatBlock', arg: 'H3', label: 'H', title: 'Заголовок' },
  { cmd: 'formatBlock', arg: 'BLOCKQUOTE', label: '❝', title: 'Цитата' },
  { cmd: 'justifyCenter', label: '⇔', title: 'По центру' },
];

// Глобальные стили редактора. Через обычный <style> тег, потому что
// нам нужен селектор :empty:before для placeholder и потомки contentEditable
// (<p>, <sup>) — styled-jsx в Next 16 App Router из коробки не подключён.
const EDITOR_STYLES = `
.rich-editor:empty:before {
  content: attr(data-placeholder);
  color: var(--ink-mute, #888);
  pointer-events: none;
}
.rich-editor p {
  margin: 0 0 0.9em 0;
}
.rich-editor p:last-child {
  margin-bottom: 0;
}
.rich-editor sup.fn-ref {
  color: var(--accent, #b8860b);
  cursor: help;
  font-weight: bold;
  margin: 0 1px;
}
.rich-editor p.fn-inline {
  font-size: 0.9em;
  color: var(--ink-mute, #666);
  border-left: 2px solid var(--border, #ccc);
  padding-left: 8px;
  margin: 0.4em 0;
}
`;

// WYSIWYG-редактор главы. contentEditable div — пользователь видит
// форматирование сразу, без отдельного предпросмотра. Хранит и отдаёт
// HTML; чистка через cleanHtml() происходит при paste и при сабмите
// (родитель вызывает cleanHtml перед загрузкой в storage).
export default function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeight = 320,
  maxHeight = 600,
  hint,
}: Props) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Что мы в последний раз отдали родителю / получили от него.
  // Если value меняется НЕ от наших onChange — это programmatic update
  // (docx import, restore draft) — тогда перезаписываем innerHTML.
  const lastValueRef = useRef<string>(value);

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Footnote popover
  const [fnOpen, setFnOpen] = useState(false);
  const [fnText, setFnText] = useState('');
  const fnRangeRef = useRef<Range | null>(null);
  const fnInputRef = useRef<HTMLTextAreaElement | null>(null);

  // Initial set + programmatic updates.
  useEffect(() => {
    if (!editorRef.current) return;
    if (value !== lastValueRef.current) {
      editorRef.current.innerHTML = value || '';
      lastValueRef.current = value || '';
    }
  }, [value]);

  // Mount: подтянем initial value один раз (на случай если useEffect
  // выше не сработал из-за value === lastValueRef.current === '').
  useEffect(() => {
    if (editorRef.current && value && editorRef.current.innerHTML === '') {
      editorRef.current.innerHTML = value;
      lastValueRef.current = value;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emitChange = () => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    lastValueRef.current = html;
    onChange(html);
  };

  // Тулбар-команды через execCommand. Это легаси-API, но реально
  // работает во всех браузерах и не требует библиотеки-редактора.
  const exec = (cmd: string, arg?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, arg);
    emitChange();
  };

  const insertSpoiler = () => {
    editorRef.current?.focus();
    const html =
      '<details><summary>Спойлер — нажми, чтобы показать</summary>текст</details>';
    document.execCommand('insertHTML', false, html);
    emitChange();
  };

  // Footnote helpers — определяем до handler'ов, чтобы onKeyDown их видел.
  const openFootnote = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      fnRangeRef.current = sel.getRangeAt(0).cloneRange();
    } else {
      fnRangeRef.current = null;
    }
    setFnText('');
    setFnOpen(true);
  };

  const closeFootnote = () => {
    setFnOpen(false);
    setFnText('');
    setTimeout(() => {
      if (fnRangeRef.current && editorRef.current) {
        editorRef.current.focus();
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(fnRangeRef.current);
      }
    }, 0);
  };

  const insertFootnote = () => {
    const trimmed = fnText.trim();
    if (!trimmed || !editorRef.current) return;
    const editor = editorRef.current;
    editor.focus();
    if (fnRangeRef.current) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(fnRangeRef.current);
    }
    const escaped = trimmed
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const html = `<sup class="fn-ref" data-fn-text="${escaped}">*</sup>`;
    document.execCommand('insertHTML', false, html);
    setFnOpen(false);
    setFnText('');
    emitChange();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // contentEditable обрабатывает Ctrl+B/I/U сам, но на macOS Safari
    // иногда страннности — перехватим явно.
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); exec('bold'); return; }
      if (k === 'i') { e.preventDefault(); exec('italic'); return; }
      if (k === 'u') { e.preventDefault(); exec('underline'); return; }
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openFootnote();
    }
  };

  // Перехватываем вставку из Word/Google Docs/Pages: чистим HTML
  // через cleanHtml и вставляем в позицию курсора. Без этого Word
  // натащит MsoNormal-классы, шрифты, цвета, и DOM редактора превратится
  // в кашу.
  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const plain = e.clipboardData.getData('text/plain');

    if (html && html.trim()) {
      const cleaned = htmlClipboardToHtml(html) ?? '';
      document.execCommand('insertHTML', false, cleaned);
    } else if (plain) {
      // Plain-text paste: разбиваем на абзацы по двойному \n,
      // одиночные \n превращаем в <br>.
      const escaped = plain
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const out = escaped
        .split(/\n{2,}/)
        .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
        .join('');
      document.execCommand('insertHTML', false, out);
    }
    emitChange();
  };

  // .docx import — заменяем содержимое или вставляем в курсор.
  const triggerDocxUpload = () => {
    setImportError(null);
    fileInputRef.current?.click();
  };

  const onDocxSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    setImportError(null);
    try {
      const html = await docxToHtml(file);
      if (!html.trim()) {
        setImportError('В документе не нашлось текста.');
        return;
      }
      const editor = editorRef.current;
      const isEmpty = !editor || !editor.innerText.trim();
      if (isEmpty) {
        if (editor) {
          editor.innerHTML = html;
          lastValueRef.current = html;
          onChange(html);
        }
        return;
      }
      const replace = window.confirm(
        'В редакторе уже есть текст. Заменить его содержимым файла?\n\n' +
          'OK — заменить, Отмена — вставить в позицию курсора.',
      );
      if (replace && editor) {
        editor.innerHTML = html;
        lastValueRef.current = html;
        onChange(html);
      } else if (editor) {
        editor.focus();
        document.execCommand('insertHTML', false, html);
        emitChange();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setImportError(`Не удалось прочитать .docx: ${msg}`);
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    if (fnOpen) setTimeout(() => fnInputRef.current?.focus(), 0);
  }, [fnOpen]);

  const onFnKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeFootnote();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      insertFootnote();
    }
  };

  // cleanHtml — импортируем, но используется родительским кодом
  // на сабмите. Здесь оставлен как доступная утилита для будущих фич
  // (например, кнопка «Очистить форматирование»). Чтобы typecheck не
  // ругался на «unused import» — явно ссылаемся.
  void cleanHtml;

  return (
    <div className="bbcode-editor">
      <style dangerouslySetInnerHTML={{ __html: EDITOR_STYLES }} />
      <div className="bbcode-toolbar">
        {TOOLBAR.map((b) => (
          <button
            key={`${b.cmd}-${b.arg ?? ''}`}
            type="button"
            className="bbcode-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec(b.cmd, b.arg)}
            title={b.title}
          >
            {b.label}
          </button>
        ))}
        <button
          type="button"
          className="bbcode-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={insertSpoiler}
          title="Спойлер (скрытый блок)"
        >
          🙈
        </button>
        <button
          type="button"
          className="bbcode-btn"
          onMouseDown={(e) => e.preventDefault()}
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

      <div
        ref={editorRef}
        className="rich-editor novel-content"
        contentEditable
        suppressContentEditableWarning
        spellCheck
        onInput={emitChange}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        data-placeholder={placeholder ?? 'Пиши обычным текстом. Жирный/курсив/центр — кнопки выше или Ctrl+B/I/U.'}
        style={{
          minHeight,
          maxHeight,
          padding: '14px 18px',
          border: '1px solid var(--border, #ccc)',
          borderRadius: 8,
          outline: 'none',
          background: 'var(--surface, #fff)',
          lineHeight: 1.6,
          overflowY: 'auto',
          cursor: 'text',
        }}
      />

      {hint && <div className="form-hint">{hint}</div>}
    </div>
  );
}
