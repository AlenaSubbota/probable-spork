'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

interface Props {
  novelId: number;
  novelTitle: string;
  totalChapters: number;
  onClose: () => void;
}

interface Point {
  chapter_number: number;
  readers: number;
}

// Модалка «куда уходят читатели». Читает из profiles.last_read (RPC
// novel_reader_funnel из миграции 022) и рисует простой bar-график:
// на какой главе сколько читателей «сейчас находится». Это reasonable
// proxy для drop-off — по нему видно, где массово бросают.
export default function FunnelModal({
  novelId,
  novelTitle,
  totalChapters,
  onClose,
}: Props) {
  const [points, setPoints] = useState<Point[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data, error: rpcErr } = await supabase.rpc('novel_reader_funnel', {
        p_novel: novelId,
      });
      if (cancelled) return;
      if (rpcErr) {
        setError(rpcErr.message);
        return;
      }
      setPoints((data ?? []) as Point[]);
    })();
    return () => { cancelled = true; };
  }, [novelId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const totalReaders = (points ?? []).reduce((s, p) => s + p.readers, 0);
  const maxReaders = Math.max(1, ...(points ?? []).map((p) => p.readers));
  // Добиваем пустые точки между первой и последней главой, чтобы виден был drop-off
  const filled: Point[] = [];
  if (points && points.length > 0 && totalChapters > 0) {
    for (let i = 1; i <= totalChapters; i++) {
      const existing = points.find((p) => p.chapter_number === i);
      filled.push({ chapter_number: i, readers: existing?.readers ?? 0 });
    }
  }

  // Средняя + медианная главы для контекста
  let medianCh = 0;
  if (points && points.length > 0) {
    const expanded: number[] = [];
    for (const p of points) {
      for (let i = 0; i < p.readers; i++) expanded.push(p.chapter_number);
    }
    expanded.sort((a, b) => a - b);
    medianCh = expanded[Math.floor(expanded.length / 2)] ?? 0;
  }
  const completionPct =
    totalChapters > 0 && points
      ? Math.round(
          ((points.find((p) => p.chapter_number === totalChapters)?.readers ?? 0) /
            Math.max(1, totalReaders)) *
            100
        )
      : 0;

  return (
    <div className="story-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="story-modal-card funnel-modal-card"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="story-modal-close"
          onClick={onClose}
          aria-label="Закрыть"
        >
          ×
        </button>
        <div className="funnel-modal-body">
          <h3 className="story-modal-title">Воронка читателей</h3>
          <p className="funnel-modal-sub">
            «{novelTitle}» — где читатели сейчас находятся
          </p>

          {error && (
            <div style={{ color: 'var(--rose)', fontSize: 13, marginTop: 8 }}>
              {error}
            </div>
          )}
          {!error && !points && (
            <div className="funnel-loading">Считаем…</div>
          )}
          {points && points.length === 0 && (
            <div className="empty-state">
              <p>Пока никто не читает — цифры появятся, когда кто-то откроет главу.</p>
            </div>
          )}

          {points && points.length > 0 && (
            <>
              <div className="funnel-stats">
                <div>
                  <div className="funnel-stat-label">Активных читателей</div>
                  <div className="funnel-stat-value">{totalReaders}</div>
                </div>
                <div>
                  <div className="funnel-stat-label">Медианная глава</div>
                  <div className="funnel-stat-value">{medianCh || '—'}</div>
                </div>
                <div>
                  <div className="funnel-stat-label">Дошли до последней</div>
                  <div className="funnel-stat-value">{completionPct}%</div>
                </div>
              </div>

              <div className="funnel-chart">
                {filled.map((p) => {
                  const h = (p.readers / maxReaders) * 100;
                  return (
                    <div
                      key={p.chapter_number}
                      className="funnel-bar"
                      title={`Глава ${p.chapter_number}: ${p.readers} ${pluralRu(
                        p.readers, 'читатель', 'читателя', 'читателей'
                      )}`}
                    >
                      <span
                        className="funnel-bar-fill"
                        style={{ height: `${h}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="funnel-axis">
                <span>гл.&nbsp;1</span>
                <span>гл.&nbsp;{Math.ceil(totalChapters / 2)}</span>
                <span>гл.&nbsp;{totalChapters}</span>
              </div>
              <p className="funnel-hint">
                Массовый провал после какой-то главы — сигнал пересмотреть её
                или проверить, не сломался ли файл.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function pluralRu(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
