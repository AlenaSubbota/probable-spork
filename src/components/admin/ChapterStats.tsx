'use client';

import { useMemo } from 'react';
import { computeChapterStats } from '@/lib/admin';

interface Props {
  content: string;
}

export default function ChapterStats({ content }: Props) {
  const stats = useMemo(() => computeChapterStats(content), [content]);

  return (
    <div className="chapter-stats">
      <div className="chapter-stats-head">
        <h3>Статистика</h3>
      </div>

      <div className="stats-row">
        <div className="stats-cell">
          <div className="stats-val">{stats.words.toLocaleString('ru-RU')}</div>
          <div className="stats-label">слов</div>
        </div>
        <div className="stats-cell">
          <div className="stats-val">{stats.chars.toLocaleString('ru-RU')}</div>
          <div className="stats-label">знаков</div>
        </div>
      </div>

      <div className="stats-row">
        <div className="stats-cell">
          <div className="stats-val">{stats.paragraphs}</div>
          <div className="stats-label">абзацев</div>
        </div>
        <div className="stats-cell">
          <div className="stats-val">~{stats.readingMinutes}</div>
          <div className="stats-label">мин чтения</div>
        </div>
      </div>

      {stats.longSentenceCount > 0 && (
        <div className="stats-alert">
          <strong>{stats.longSentenceCount}</strong>{' '}
          {stats.longSentenceCount === 1 ? 'длинное предложение' : 'длинных предложений'}{' '}
          ({stats.longSentenceThreshold}+ слов) — возможно стоит разбить.
        </div>
      )}

      {stats.topRepeats.length > 0 && (
        <div className="stats-section">
          <div className="stats-section-title">Часто повторяется</div>
          <div className="stats-repeats">
            {stats.topRepeats.map((r) => (
              <span key={r.word} className="stats-repeat">
                {r.word} <em>×{r.count}</em>
              </span>
            ))}
          </div>
        </div>
      )}

      {stats.words === 0 && (
        <div className="stats-empty">
          Начни печатать — статистика появится в реальном времени.
        </div>
      )}
    </div>
  );
}
