'use client';

import { useRef, useState } from 'react';
import { bbToHtml } from '@/lib/bbcode';

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
  const [showPreview, setShowPreview] = useState(true);

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

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      wrap('b');
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      wrap('i');
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

      <div className={`bbcode-body${showPreview ? ' with-preview' : ''}`}>
        <textarea
          ref={taRef}
          className="bbcode-textarea"
          style={{ minHeight }}
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
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
