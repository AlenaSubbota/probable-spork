'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { useToasts, ToastStack } from '@/components/ui/Toast';

export interface ChapterListItem {
  chapter_number: number;
  is_paid: boolean;
  content_path: string | null;
  published_at: string | null;
  // optional title in case there's any in DB; chaptify не использует
  title?: string | null;
}

interface Props {
  novelId: number;
  novelFirebaseId: string;
  initial: ChapterListItem[];
}

// Список существующих глав с быстрыми действиями (тогл платная/
// бесплатная, ред., удалить). По образцу tene/AdminPanel.jsx, чтобы
// переводчик при заливке новых видел всю «карту» новеллы и мог
// одним кликом перевести вчерашнюю главу в бесплатную (а массовое
// открытие — через bulk-форму выше).
export default function ChapterListPanel({
  novelId,
  novelFirebaseId,
  initial,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const { items: toasts, push, dismiss } = useToasts();

  const [chapters, setChapters] = useState<ChapterListItem[]>(
    [...initial].sort((a, b) => b.chapter_number - a.chapter_number)
  );
  const [busyNum, setBusyNum] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(initial.length > 30);

  const togglePaid = async (ch: ChapterListItem) => {
    setBusyNum(ch.chapter_number);
    const next = !ch.is_paid;
    const { error } = await supabase
      .from('chapters')
      .update({ is_paid: next })
      .eq('novel_id', novelId)
      .eq('chapter_number', ch.chapter_number);
    setBusyNum(null);
    if (error) {
      push('error', error.message);
      return;
    }
    setChapters((prev) =>
      prev.map((c) =>
        c.chapter_number === ch.chapter_number ? { ...c, is_paid: next } : c
      )
    );
    if (!next) {
      push(
        'info',
        `Глава ${ch.chapter_number} стала бесплатной. Если открываешь несколько — лучше через массовую загрузку (тогда подписчикам один пуш).`
      );
    } else {
      push('success', `Глава ${ch.chapter_number} снова платная.`);
    }
    router.refresh();
  };

  const remove = async (ch: ChapterListItem) => {
    if (
      !window.confirm(
        `Удалить главу ${ch.chapter_number}? Файл из storage тоже удалится.`
      )
    ) {
      return;
    }
    setBusyNum(ch.chapter_number);
    try {
      if (ch.content_path) {
        await supabase.storage.from('chapter_content').remove([ch.content_path]);
      }
      const { error } = await supabase
        .from('chapters')
        .delete()
        .eq('novel_id', novelId)
        .eq('chapter_number', ch.chapter_number);
      if (error) throw error;
      setChapters((prev) =>
        prev.filter((c) => c.chapter_number !== ch.chapter_number)
      );
      push('success', `Глава ${ch.chapter_number} удалена.`);
      router.refresh();
    } catch (err) {
      push('error', err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusyNum(null);
    }
  };

  if (chapters.length === 0) {
    return (
      <section className="chapter-list-panel">
        <div className="chapter-list-panel-head">
          <h3>Все главы новеллы</h3>
          <span className="chapter-list-panel-count">0</span>
        </div>
        <div className="empty-state" style={{ padding: 18, textAlign: 'left' }}>
          <p style={{ margin: 0 }}>
            Глав ещё нет. После загрузки они появятся здесь — с
            возможностью переключить «платная/бесплатная» одним кликом.
          </p>
        </div>
        <ToastStack items={toasts} onDismiss={dismiss} />
      </section>
    );
  }

  const visible = collapsed ? chapters.slice(0, 20) : chapters;
  const hidden = chapters.length - visible.length;

  const paidCount = chapters.filter((c) => c.is_paid).length;
  const freeCount = chapters.length - paidCount;

  return (
    <section className="chapter-list-panel">
      <div className="chapter-list-panel-head">
        <h3>Все главы новеллы</h3>
        <div className="chapter-list-panel-stats">
          <span className="chapter-list-panel-stat chapter-list-panel-stat--free">
            🟢 {freeCount} бесплатных
          </span>
          <span className="chapter-list-panel-stat chapter-list-panel-stat--paid">
            🔒 {paidCount} платных
          </span>
        </div>
      </div>
      <p className="chapter-list-panel-hint">
        Тап «🔒 / 🟢» — переключить платность. «✎» — открыть редактор.
        «🗑» — удалить (вместе с файлом в storage). Для пакетного открытия
        нескольких глав используй блок массовой загрузки выше — он шлёт
        ОДНО уведомление.
      </p>

      <ul className="chapter-list-panel-list">
        {visible.map((ch) => {
          const busy = busyNum === ch.chapter_number;
          return (
            <li key={ch.chapter_number} className="chapter-list-panel-row">
              <span className="chapter-list-panel-num">
                Глава {ch.chapter_number}
              </span>
              <button
                type="button"
                className={`chapter-list-panel-toggle ${
                  ch.is_paid ? 'is-paid' : 'is-free'
                }`}
                onClick={() => togglePaid(ch)}
                disabled={busy}
                aria-label={
                  ch.is_paid ? 'Сделать бесплатной' : 'Сделать платной'
                }
                title={
                  ch.is_paid
                    ? 'Сейчас платная — клик откроет бесплатно'
                    : 'Сейчас бесплатная — клик сделает платной'
                }
              >
                {ch.is_paid ? '🔒 Платная' : '🟢 Бесплатная'}
              </button>
              <Link
                href={`/admin/novels/${novelFirebaseId}/chapters/${ch.chapter_number}/edit`}
                className="chapter-list-panel-action chapter-list-panel-action--edit"
                aria-label={`Редактировать главу ${ch.chapter_number}`}
                title="Редактировать"
              >
                ✎
              </Link>
              <button
                type="button"
                className="chapter-list-panel-action chapter-list-panel-action--delete"
                onClick={() => remove(ch)}
                disabled={busy}
                aria-label={`Удалить главу ${ch.chapter_number}`}
                title="Удалить"
              >
                🗑
              </button>
            </li>
          );
        })}
      </ul>

      {hidden > 0 && (
        <button
          type="button"
          className="chapter-list-panel-more"
          onClick={() => setCollapsed(false)}
        >
          Показать ещё {hidden}
        </button>
      )}
      {!collapsed && chapters.length > 30 && (
        <button
          type="button"
          className="chapter-list-panel-more"
          onClick={() => setCollapsed(true)}
        >
          Свернуть
        </button>
      )}

      <ToastStack items={toasts} onDismiss={dismiss} />
    </section>
  );
}
