'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';

interface Props {
  open: boolean;
  onClose: () => void;
  novelId: number;
  novelFirebaseId: string;
  novelTitle: string | null;
  currentChapter: number;
}

interface Chapter {
  chapter_number: number;
  is_paid: boolean;
  price_coins: number | null;
  published_at: string | null;
}

// Drawer с оглавлением главы (≡). Открывается кнопкой из reader-toolbar.
// Подгружает список всех опубликованных глав новеллы и подсвечивает
// текущую. Клик по главе — Link на /novel/<id>/<n>, drawer закрывается
// автоматически при навигации (unmount).
//
// Рендерится через portal в document.body, чтобы не зависеть от
// reader-wrapper стекинг-контекста и перекрывать sticky элементы.
export default function ChapterTOC({
  open,
  onClose,
  novelId,
  novelFirebaseId,
  novelTitle,
  currentChapter,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Загружаем список глав 1 раз при первом открытии
  useEffect(() => {
    if (!open || chapters.length > 0) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const supabase = createClient();
      const { data } = await supabase
        .from('chapters')
        .select('chapter_number, is_paid, price_coins, published_at')
        .eq('novel_id', novelId)
        .not('published_at', 'is', null)
        .lte('published_at', new Date().toISOString())
        .order('chapter_number', { ascending: true });
      if (!cancelled && Array.isArray(data)) setChapters(data as Chapter[]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, novelId, chapters.length]);

  // Esc закрывает
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Body scroll-lock пока открыт
  useEffect(() => {
    if (!open) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  if (!mounted) return null;

  const drawer = (
    <>
      <div
        className={`reader-toc-overlay${open ? ' is-open' : ''}`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        className={`reader-toc${open ? ' is-open' : ''}`}
        aria-hidden={!open}
        aria-label="Оглавление"
      >
        <div className="reader-toc-head">
          <div>
            <div className="reader-toc-kicker">Оглавление</div>
            {novelTitle && <div className="reader-toc-novel">{novelTitle}</div>}
          </div>
          <button
            type="button"
            className="reader-toc-close"
            onClick={onClose}
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>

        <div className="reader-toc-body">
          {loading ? (
            <p className="reader-toc-empty">Загружаем…</p>
          ) : chapters.length === 0 ? (
            <p className="reader-toc-empty">Глав пока нет.</p>
          ) : (
            <ul className="reader-toc-list">
              {chapters.map((c) => {
                const isCurrent = c.chapter_number === currentChapter;
                return (
                  <li key={c.chapter_number}>
                    <Link
                      href={`/novel/${novelFirebaseId}/${c.chapter_number}`}
                      className={`reader-toc-item${isCurrent ? ' is-current' : ''}`}
                      onClick={onClose}
                    >
                      <span className="reader-toc-item-num">
                        Глава {c.chapter_number}
                      </span>
                      {c.is_paid && (
                        <span className="reader-toc-item-badge">
                          {c.price_coins ?? 10} ⭐
                        </span>
                      )}
                      {isCurrent && (
                        <span className="reader-toc-item-here">сейчас</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </>
  );

  return createPortal(drawer, document.body);
}
