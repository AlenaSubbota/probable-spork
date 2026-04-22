'use client';

import { useEffect, useState } from 'react';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

interface Props {
  item: ToastItem;
  onDismiss: (id: number) => void;
}

// Один тост. Автоматически скрывается через 4 сек, или по клику.
export function Toast({ item, onDismiss }: Props) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(item.id), 4000);
    return () => clearTimeout(t);
  }, [item.id, onDismiss]);

  return (
    <div
      className={`toast toast--${item.kind}`}
      role={item.kind === 'error' ? 'alert' : 'status'}
      onClick={() => onDismiss(item.id)}
    >
      <span className="toast-icon" aria-hidden="true">
        {item.kind === 'success' ? '✓' : item.kind === 'error' ? '✕' : 'ℹ'}
      </span>
      <span className="toast-text">{item.text}</span>
    </div>
  );
}

// Хук для локального тост-стека внутри формы. Проще глобального контекста
// на текущем этапе (нам нужен тост только по факту сохранения).
export function useToasts() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = (kind: ToastKind, text: string) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, kind, text }]);
  };
  const dismiss = (id: number) =>
    setItems((prev) => prev.filter((t) => t.id !== id));
  return { items, push, dismiss };
}

// Контейнер для рендера стека. Фиксированная позиция — справа сверху.
export function ToastStack({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="toast-stack" aria-live="polite">
      {items.map((t) => (
        <Toast key={t.id} item={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
