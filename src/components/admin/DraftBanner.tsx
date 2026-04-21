'use client';

import { timeAgo } from '@/lib/format';

interface Props {
  updatedAt: string;
  onRestore: () => void;
  onDiscard: () => void;
}

export default function DraftBanner({ updatedAt, onRestore, onDiscard }: Props) {
  return (
    <div className="draft-banner">
      <div className="draft-banner-icon" aria-hidden="true">◷</div>
      <div className="draft-banner-text">
        <strong>Есть сохранённый черновик.</strong> Обновлён {timeAgo(updatedAt)}.
      </div>
      <button type="button" className="btn btn-primary" onClick={onRestore}>
        Восстановить
      </button>
      <button type="button" className="btn btn-ghost" onClick={onDiscard}>
        Начать заново
      </button>
    </div>
  );
}
