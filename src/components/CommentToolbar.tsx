'use client';

import { useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { commentToHtml } from '@/lib/commentFormat';

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  disabled?: boolean;
  /** ID привязки, чтобы textarea ref разнести между формами */
  id?: string;
  /** Явный аутофокус при монтировании (для reply-формы) */
  autoFocus?: boolean;
}

export interface CommentToolbarRef {
  focus: () => void;
}

// Textarea для комментария с кнопками BB-кодов и живым preview.
// Выделил текст в textarea → нажал «B» → выделение оборачивается
// в [b]…[/b]. Без выделения — вставляется маркер [b][/b] и курсор
// встаёт между тегами.
// Preview раскрывается по клику на «Просмотр» — показывает как
// комментарий будет выглядеть после публикации.
const CommentToolbar = forwardRef<CommentToolbarRef, Props>(function CommentToolbar(
  { value, onChange, placeholder, rows = 3, maxLength = 2000, disabled, id, autoFocus },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showPreview, setShowPreview] = useState(false);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }));

  const wrapSelection = (before: string, after: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = value.slice(start, end);
    const inserted = before + selected + after;
    const next = value.slice(0, start) + inserted + value.slice(end);
    onChange(next);
    // Позиционируем курсор либо внутри пустого маркера, либо сразу
    // после вставленного блока
    requestAnimationFrame(() => {
      ta.focus();
      const cursorPos = selected
        ? start + before.length + selected.length + after.length
        : start + before.length;
      ta.setSelectionRange(
        selected ? start : cursorPos,
        selected ? start + inserted.length : cursorPos,
      );
    });
  };

  const insertUrl = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = value.slice(start, end).trim();
    const url = prompt('Ссылка (https://…):', selected.match(/^https?:\/\//) ? selected : 'https://');
    if (!url) return;
    const label = selected && !selected.match(/^https?:\/\//) ? selected : '';
    const inserted = label ? `[url=${url}]${label}[/url]` : `[url]${url}[/url]`;
    const next = value.slice(0, start) + inserted + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + inserted.length, start + inserted.length);
    });
  };

  // Ctrl/Cmd + B / I — хот-кеи
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') {
        e.preventDefault();
        wrapSelection('[b]', '[/b]');
      } else if (k === 'i') {
        e.preventDefault();
        wrapSelection('[i]', '[/i]');
      }
    }
  };

  const btns: Array<{ label: string; title: string; before: string; after: string; onClick?: () => void }> = [
    { label: 'B',   title: 'Жирный (Ctrl+B)',   before: '[b]', after: '[/b]' },
    { label: 'I',   title: 'Курсив (Ctrl+I)',   before: '[i]', after: '[/i]' },
    { label: 'U',   title: 'Подчёркивание',    before: '[u]', after: '[/u]' },
    { label: 'S',   title: 'Зачёркнутый',      before: '[s]', after: '[/s]' },
    { label: '🫥',  title: 'Спойлер',          before: '[spoiler]', after: '[/spoiler]' },
    { label: '“ ”', title: 'Цитата',           before: '[quote]', after: '[/quote]' },
  ];

  return (
    <div className="comment-toolbar-wrap">
      <div className="comment-toolbar" role="toolbar" aria-label="Форматирование">
        {btns.map((b) => (
          <button
            key={b.label}
            type="button"
            className="comment-toolbar-btn"
            title={b.title}
            onClick={() => wrapSelection(b.before, b.after)}
            disabled={disabled}
          >
            {b.label}
          </button>
        ))}
        <button
          type="button"
          className="comment-toolbar-btn"
          title="Ссылка"
          onClick={insertUrl}
          disabled={disabled}
        >
          🔗
        </button>
        <button
          type="button"
          className={`comment-toolbar-btn comment-toolbar-btn--toggle${showPreview ? ' is-active' : ''}`}
          onClick={() => setShowPreview((v) => !v)}
          disabled={disabled}
          title="Предпросмотр"
        >
          {showPreview ? 'Текст' : 'Просмотр'}
        </button>
      </div>

      {showPreview ? (
        <div
          className="comment-toolbar-preview"
          dangerouslySetInnerHTML={{
            __html: value.trim()
              ? commentToHtml(value)
              : '<span class="comment-toolbar-preview-empty">— пусто —</span>',
          }}
        />
      ) : (
        <textarea
          ref={textareaRef}
          id={id}
          className="form-textarea"
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          autoFocus={autoFocus}
        />
      )}
    </div>
  );
});

export default CommentToolbar;
