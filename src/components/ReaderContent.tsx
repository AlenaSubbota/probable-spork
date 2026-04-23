'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createClient } from '@/utils/supabase/client';
import {
  loadSettings,
  saveSettings,
  getFontCss,
  DEFAULT_SETTINGS,
  type ReaderSettings,
} from '@/lib/reader';
import ReaderSettingsPanel from './ReaderSettings';
import QuoteBubble from './QuoteBubble';
import SleepTimerOverlay from './SleepTimerOverlay';
import ChapterTOC from './reader/ChapterTOC';

interface GlossaryItem {
  term_original: string;
  term_translation: string;
  category: string | null;
}

interface Props {
  content: string;
  novelId: number;
  chapterNumber: number;
  glossary?: GlossaryItem[];
  novelFirebaseId?: string;
  novelTitle?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  character: 'Персонаж',
  place: 'Место',
  term: 'Термин',
  technique: 'Техника',
  other: 'Прочее',
};
function labelForCategory(cat: string): string {
  return CATEGORY_LABELS[cat] ?? cat;
}

export default function ReaderContent({
  content,
  novelId,
  chapterNumber,
  glossary = [],
  novelFirebaseId,
  novelTitle,
}: Props) {
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);

  // Таймер сна.
  // selectedPreset — изначально выбранный пресет (для подсветки в UI), не тикает.
  // sleepMinLeft — оставшиеся минуты (тикают от пресета до 0). 0 = истёк.
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [sleepMinLeft, setSleepMinLeft] = useState<number | null>(null);
  const [sleepExpired, setSleepExpired] = useState(false);
  const [sleepDismissed, setSleepDismissed] = useState(false);

  const contentRef = useRef<HTMLDivElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  // Pages mode state — честный подсчёт страниц через scrollWidth /
  // clientWidth контейнера с CSS-колонками. Пересчитывается при
  // изменении шрифта / line-height / размера экрана / загрузки
  // шрифтов. Активно только при settings.readMode === 'pages'.
  const [pageWidth, setPageWidth] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Счётчик комментариев к этой главе (для кнопки в toolbar).
  // Дешёвый count-запрос без тяги данных; обновляется при mount.
  const [commentCount, setCommentCount] = useState<number | null>(null);

  // ---- 1. Загрузка настроек ----
  useEffect(() => {
    setSettings(loadSettings());
    setReady(true);
  }, []);

  // ---- 2. Автосохранение настроек ----
  const updateSettings = useCallback((next: ReaderSettings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  // ---- 3. Горячие клавиши (A+/A-/F = focus) ----
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '+' || e.key === '=') {
        updateSettings({
          ...settings,
          fontSize: Math.min(26, settings.fontSize + 1),
        });
      } else if (e.key === '-' || e.key === '_') {
        updateSettings({
          ...settings,
          fontSize: Math.max(13, settings.fontSize - 1),
        });
      } else if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') {
        updateSettings({ ...settings, focusMode: !settings.focusMode });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [settings, updateSettings]);

  // ---- 4. Сохранение прогресса чтения (через RPC update_my_profile) ----
  const saveProgress = useCallback(
    async (paragraphIndex: number) => {
      try {
        localStorage.setItem(
          `progress_${novelId}`,
          JSON.stringify({
            chapterId: chapterNumber,
            paragraphIndex,
            timestamp: new Date().toISOString(),
          })
        );
      } catch { /* ignore */ }

      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Читаем текущий last_read, мержим, обновляем через RPC (RLS на profiles запрещает UPDATE напрямую)
      const { data: profile } = await supabase
        .from('profiles')
        .select('last_read')
        .eq('id', user.id)
        .maybeSingle();

      type LastReadEntry = {
        novelId: number;
        chapterId: number;
        timestamp: string;
        paragraphIndex?: number;
      };
      const prev = (profile?.last_read || {}) as Record<string, LastReadEntry>;
      const updated = {
        ...prev,
        [String(novelId)]: {
          novelId,
          chapterId: chapterNumber,
          paragraphIndex,
          timestamp: new Date().toISOString(),
        },
      };

      // SECURITY DEFINER RPC из tene-схемы
      await supabase.rpc('update_my_profile', {
        data_to_update: { last_read: updated },
      });

      // Логируем день активности (для стрика). Не блокируем.
      supabase.rpc('log_reading_day').then(() => {}, () => {});
    },
    [novelId, chapterNumber]
  );

  // ---- 4.5. Inline-глоссарий: оборачиваем совпадения в спаны, по клику
  //           показываем поповер с переводом + категорией ----
  const [glossaryPopover, setGlossaryPopover] = useState<null | {
    x: number;
    y: number;
    item: GlossaryItem;
  }>(null);

  useEffect(() => {
    if (!ready) return;
    const container = contentRef.current;
    if (!container || glossary.length === 0) return;

    // Сортируем по убыванию длины — чтобы более длинные термины
    // (вроде «Великий Клан Цао») ловились раньше подстрок («Цао»).
    const sortedTerms = [...glossary].sort(
      (a, b) => b.term_original.length - a.term_original.length
    );
    const lookup = new Map<string, GlossaryItem>();
    for (const g of sortedTerms) lookup.set(g.term_original.toLowerCase(), g);

    // Строим регулярку: экранируем спец-символы, группируем через | с границами слов.
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = sortedTerms.map((g) => escape(g.term_original)).join('|');
    if (!pattern) return;
    // \b не работает для кириллицы → используем lookahead/lookbehind по не-буквам.
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}])(${pattern})(?![\\p{L}\\p{N}])`,
      'giu'
    );

    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        // Не трогаем код, скрипты, уже обёрнутые термины и заголовки
        if (parent.closest('code, pre, script, style, .glossary-term'))
          return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue || !node.nodeValue.trim())
          return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let tn = walker.nextNode();
    while (tn) {
      textNodes.push(tn as Text);
      tn = walker.nextNode();
    }

    const wrapped: HTMLElement[] = [];
    for (const node of textNodes) {
      const text = node.nodeValue ?? '';
      if (!re.test(text)) {
        re.lastIndex = 0;
        continue;
      }
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        if (match.index > last) {
          frag.appendChild(
            document.createTextNode(text.slice(last, match.index))
          );
        }
        const term = match[0];
        const item = lookup.get(term.toLowerCase());
        if (item) {
          const span = document.createElement('span');
          span.className = 'glossary-term';
          span.dataset.term = item.term_original;
          span.textContent = term;
          frag.appendChild(span);
          wrapped.push(span);
        } else {
          frag.appendChild(document.createTextNode(term));
        }
        last = match.index + term.length;
      }
      if (last < text.length) {
        frag.appendChild(document.createTextNode(text.slice(last)));
      }
      node.parentNode?.replaceChild(frag, node);
    }

    const onSpanClick = (e: Event) => {
      const target = e.currentTarget as HTMLElement;
      const termKey = target.dataset.term;
      if (!termKey) return;
      const item = glossary.find((g) => g.term_original === termKey);
      if (!item) return;
      const rect = target.getBoundingClientRect();
      setGlossaryPopover({
        x: rect.left + rect.width / 2,
        y: rect.bottom + window.scrollY + 6,
        item,
      });
      e.stopPropagation();
    };
    for (const span of wrapped) {
      span.addEventListener('click', onSpanClick);
    }

    // Клик вне термина закрывает поповер
    const onDocClick = () => setGlossaryPopover(null);
    document.addEventListener('click', onDocClick);
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGlossaryPopover(null);
    };
    document.addEventListener('keydown', onEsc);

    return () => {
      for (const span of wrapped) span.removeEventListener('click', onSpanClick);
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [ready, content, glossary]);

  // ---- 5. Отслеживание активного абзаца + сохранение прогресса ----
  // Логика mode-aware:
  //  - scroll-режим: слушаем window.scroll; best = абзац ближайший к
  //    середине viewport (по vertical middle).
  //  - pages-режим: слушаем container.scroll; best = первый абзац,
  //    который попадает в текущую видимую колонку (offsetLeft в пределах
  //    [scrollLeft, scrollLeft + clientWidth]).
  //
  // В обоих случаях после 1.5 секунд без скролла дебаунсом сохраняем
  // paragraphIndex — эта метрика стабильна при смене шрифта / режима.
  useEffect(() => {
    if (!ready) return;
    const container = contentRef.current;
    if (!container) return;

    const paragraphs = container.querySelectorAll<HTMLElement>('p, h1, h2, h3, blockquote');
    if (paragraphs.length === 0) return;

    let lastActiveId = -1;
    const isPages = settings.readMode === 'pages';

    const findBestVertical = (): number => {
      const viewportMid = window.innerHeight / 2;
      let bestIdx = 0;
      let bestDist = Infinity;
      paragraphs.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        const elMid = r.top + r.height / 2;
        const dist = Math.abs(elMid - viewportMid);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      });
      return bestIdx;
    };

    const findBestPaged = (): number => {
      // В multi-column layout offsetLeft абзаца — его позиция в
      // абсолютном flow, которое браузер режет на колонки. Ищем
      // первый элемент, у которого offsetLeft >= scrollLeft (т.е.
      // первая колонка в текущем viewport'е).
      const scrollLeft = container.scrollLeft;
      const pageW = container.clientWidth || 1;
      let bestIdx = 0;
      for (let i = 0; i < paragraphs.length; i++) {
        const el = paragraphs[i];
        if (el.offsetLeft + el.offsetWidth >= scrollLeft + 1) {
          bestIdx = i;
          if (el.offsetLeft >= scrollLeft) break; // первый полностью видимый
        }
        // Если абзац целиком позади — пропускаем.
        if (el.offsetLeft > scrollLeft + pageW) break;
      }
      return bestIdx;
    };

    const applyActive = (bestIdx: number) => {
      if (bestIdx === lastActiveId) return;
      if (lastActiveId >= 0 && paragraphs[lastActiveId]) {
        paragraphs[lastActiveId].classList.remove('focus-active');
      }
      paragraphs[bestIdx]?.classList.add('focus-active');
      lastActiveId = bestIdx;
    };

    const onAnyScroll = () => {
      const best = isPages ? findBestPaged() : findBestVertical();
      applyActive(best);
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => saveProgress(best), 1500);
    };

    applyActive(isPages ? findBestPaged() : findBestVertical());

    if (isPages) {
      container.addEventListener('scroll', onAnyScroll, { passive: true });
    } else {
      window.addEventListener('scroll', onAnyScroll, { passive: true });
    }

    return () => {
      if (isPages) container.removeEventListener('scroll', onAnyScroll);
      else window.removeEventListener('scroll', onAnyScroll);
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      if (lastActiveId >= 0 && paragraphs[lastActiveId]) {
        paragraphs[lastActiveId].classList.remove('focus-active');
      }
    };
  }, [ready, content, saveProgress, settings.focusMode, settings.readMode]);

  // ---- 6. Восстановление позиции из localStorage при заходе ----
  // paragraphIndex стабилен при смене шрифта / режима — в отличие от
  // абсолютного scroll-pixel'а. В pages-режиме скроллим контейнер
  // горизонтально к колонке, где абзац находится (ищем element →
  // его offsetLeft относительно контейнера → делим на pageWidth).
  useEffect(() => {
    if (!ready) return;
    const container = contentRef.current;
    if (!container) return;
    try {
      const raw = localStorage.getItem(`progress_${novelId}`);
      if (!raw) return;
      const data = JSON.parse(raw) as { chapterId: number; paragraphIndex: number };
      if (data.chapterId !== chapterNumber) return;
      const paragraphs = container.querySelectorAll<HTMLElement>('p, h1, h2, h3, blockquote');
      const target = paragraphs[data.paragraphIndex];
      if (!target) return;
      setTimeout(() => {
        if (settings.readMode === 'pages') {
          // В multi-column layout offsetLeft даёт корректную позицию
          // колонки относительно scrollLeft контейнера.
          const pageW = container.clientWidth;
          if (pageW > 0) {
            const targetLeft = target.offsetLeft;
            // Снэпаем к началу ближайшей колонки
            const pageIdx = Math.floor(targetLeft / pageW);
            container.scrollTo({ left: pageIdx * pageW, behavior: 'instant' as ScrollBehavior });
          }
        } else {
          target.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
        }
      }, 160);
    } catch { /* ignore */ }
    // settings.readMode — чтобы при смене режима позиция корректно
    // переперезжала в новый scrollContainer (window vs contentRef).
  }, [ready, content, novelId, chapterNumber, settings.readMode]);

  // ---- 6.5. Pages mode: расчёт totalPages + currentPage ----
  // Запускаем ResizeObserver на контейнере; пересчитываем после
  // загрузки шрифтов и при изменении шрифта / line-height. При
  // scroll — currentPage следует за позицией.
  useEffect(() => {
    if (!ready) return;
    if (settings.readMode !== 'pages') {
      // В scroll-режиме сбрасываем, чтобы индикатор не показывал
      // устаревшие данные при обратном переключении.
      setPageWidth(0);
      setCurrentPage(0);
      setTotalPages(1);
      return;
    }
    const container = contentRef.current;
    if (!container) return;

    const calc = () => {
      const w = container.clientWidth;
      if (!w) return;
      // Учитываем column-gap: каждая колонка + gap = шаг snap.
      // Но в нашем CSS gap 40 px, column-width = clientWidth,
      // итого фактический шаг ≈ clientWidth + gap. Для scroll-snap
      // это не важно (snap сам подгонит), но для currentPage точнее
      // считать по clientWidth (каждая колонка занимает w, gap —
      // перемычка).
      setPageWidth(w);
      const total = Math.max(1, Math.ceil(container.scrollWidth / w));
      setTotalPages(total);
    };

    // После загрузки шрифтов layout может поменяться (Manrope/Lora
    // грузятся async) — без ожидания scrollWidth даст неверное число.
    const fontsReady = document.fonts?.ready;
    if (fontsReady) fontsReady.then(calc).catch(calc);
    else calc();

    const ro = new ResizeObserver(() => calc());
    ro.observe(container);

    const onScroll = () => {
      const w = container.clientWidth || 1;
      setCurrentPage(Math.round(container.scrollLeft / w));
    };
    container.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      ro.disconnect();
      container.removeEventListener('scroll', onScroll);
    };
  }, [
    ready,
    content,
    settings.readMode,
    settings.fontSize,
    settings.lineHeight,
    settings.paragraphSpacing,
    settings.textIndent,
    settings.fontFamily,
  ]);

  // ---- 6.6. Keyboard nav в pages-режиме (← → / PgUp / PgDn / Space) ----
  useEffect(() => {
    if (!ready) return;
    if (settings.readMode !== 'pages') return;
    const container = contentRef.current;
    if (!container) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      )
        return;
      const w = container.clientWidth;
      if (!w) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        container.scrollBy({ left: w, behavior: 'smooth' });
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        container.scrollBy({ left: -w, behavior: 'smooth' });
      } else if (e.key === 'Home') {
        e.preventDefault();
        container.scrollTo({ left: 0, behavior: 'smooth' });
      } else if (e.key === 'End') {
        e.preventDefault();
        container.scrollTo({ left: container.scrollWidth, behavior: 'smooth' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ready, settings.readMode]);

  // ---- 6.7. Smart tap/click navigation в pages-режиме ----
  // Тап по левой трети экрана = prev page, правой трети = next.
  // Центр игнорируем — это зона для выделений и глоссария.
  const onContentClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (settings.readMode !== 'pages') return;
      const target = e.target as HTMLElement;
      // Не перехватываем клики по интерактивным элементам, ссылкам,
      // выделенным терминам глоссария, quote-bubble и т.п.
      if (
        target.closest(
          'a, button, input, textarea, select, [contenteditable="true"], .glossary-term, .quote-bubble'
        )
      ) {
        return;
      }
      const container = contentRef.current;
      if (!container) return;
      const w = container.clientWidth;
      if (!w) return;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (x < w * 0.33) {
        container.scrollBy({ left: -w, behavior: 'smooth' });
      } else if (x > w * 0.67) {
        container.scrollBy({ left: w, behavior: 'smooth' });
      }
      // Средняя треть — для Фазы 2 (toggle UI); пока ничего.
    },
    [settings.readMode]
  );

  const scrollPageBy = useCallback(
    (direction: 1 | -1) => {
      const container = contentRef.current;
      if (!container) return;
      const w = container.clientWidth;
      if (!w) return;
      container.scrollBy({ left: direction * w, behavior: 'smooth' });
    },
    []
  );

  // ---- 6.8. Подгружаем количество комментариев для бейджа в toolbar ----
  // Быстрый count(*) без вытягивания данных. Не критично — если RLS
  // на comments разрешает SELECT (в tene уже так), работает.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { count } = await supabase
        .from('comments')
        .select('id', { count: 'exact', head: true })
        .eq('novel_id', novelId)
        .eq('chapter_number', chapterNumber)
        .is('deleted_at', null);
      if (!cancelled && typeof count === 'number') setCommentCount(count);
    })();
    return () => {
      cancelled = true;
    };
  }, [novelId, chapterNumber]);

  // Утилита: скроллим к секции комментариев. В pages-режиме сначала
  // прыгаем к последней странице, потом к .comments-section ниже.
  const scrollToComments = useCallback(() => {
    const sec = document.querySelector('.comments-section');
    if (!sec) return;
    if (settings.readMode === 'pages') {
      const container = contentRef.current;
      if (container) {
        container.scrollTo({ left: container.scrollWidth, behavior: 'instant' as ScrollBehavior });
      }
      // После листания контента в конец — скроллим окно к секции
      setTimeout(() => sec.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    } else {
      sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [settings.readMode]);

  // ---- 7. Таймер сна (обратный отсчёт по selectedPreset) ----
  useEffect(() => {
    if (selectedPreset === null) {
      setSleepMinLeft(null);
      setSleepExpired(false);
      return;
    }
    const expireAt = Date.now() + selectedPreset * 60 * 1000;
    setSleepMinLeft(selectedPreset);
    setSleepExpired(false);
    const tick = () => {
      const leftMs = expireAt - Date.now();
      if (leftMs <= 0) {
        setSleepMinLeft(0);
        setSleepExpired(true);
      } else {
        setSleepMinLeft(Math.ceil(leftMs / 60_000));
      }
    };
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [selectedPreset]);

  if (!ready) {
    return <div className="novel-content" style={{ minHeight: 400 }} />;
  }

  const bodyStyle: React.CSSProperties = {
    fontSize:   `${settings.fontSize}px`,
    lineHeight: settings.lineHeight,
    fontFamily: getFontCss(settings.fontFamily),
    textAlign:  settings.textAlign,
    color:      'var(--ink)',
  };

  return (
    <div
      className={`reader-wrapper${settings.focusMode ? ' focus-mode' : ''}`}
      data-theme={settings.theme ?? 'light'}
      data-read-mode={settings.readMode ?? 'scroll'}
    >
      <div className="reader-toolbar">
        {novelFirebaseId && (
          <button
            type="button"
            className="chip"
            onClick={() => setTocOpen(true)}
            title="Оглавление"
          >
            ≡ Оглавление
          </button>
        )}
        <button
          type="button"
          className={`chip${settings.focusMode ? ' active' : ''}`}
          onClick={() => updateSettings({ ...settings, focusMode: !settings.focusMode })}
          title="F — включить/выключить"
        >
          ◉ Фокус
        </button>
        <button
          type="button"
          className="chip reader-toolbar-comments"
          onClick={scrollToComments}
          title="К обсуждению главы"
        >
          💬
          {commentCount !== null && commentCount > 0 && (
            <span className="chip-count">{commentCount}</span>
          )}
        </button>
        <button
          type="button"
          className="chip"
          onClick={() => setSettingsOpen(true)}
          aria-label="Настройки чтения"
        >
          ⚙ Настройки
        </button>
      </div>

      {novelFirebaseId && (
        <ChapterTOC
          open={tocOpen}
          onClose={() => setTocOpen(false)}
          novelId={novelId}
          novelFirebaseId={novelFirebaseId}
          novelTitle={novelTitle ?? null}
          currentChapter={chapterNumber}
        />
      )}

      <div className="novel-content-host">
        <div
          ref={contentRef}
          className="novel-content"
          style={bodyStyle}
          onClick={onContentClick}
          dangerouslySetInnerHTML={{ __html: content }}
        />

        {settings.readMode === 'pages' && totalPages > 1 && (
          <>
            {/* Боковые кнопки-стрелки для десктопа. На мобиле
                использовать свайп или тап по краю экрана (smart nav). */}
            <button
              type="button"
              className="reader-page-btn reader-page-btn--prev"
              onClick={() => scrollPageBy(-1)}
              disabled={currentPage === 0}
              aria-label="Предыдущая страница"
              title="← или PgUp"
            >
              ‹
            </button>
            <button
              type="button"
              className="reader-page-btn reader-page-btn--next"
              onClick={() => scrollPageBy(1)}
              disabled={currentPage >= totalPages - 1}
              aria-label="Следующая страница"
              title="→ или PgDn"
            >
              ›
            </button>

            {/* Индикатор «Стр. X из Y» с полоской-прогрессом. Снизу
                страницы, кликабельный — скроллит к месту. */}
            <div
              className="reader-page-indicator"
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={totalPages}
              aria-valuenow={currentPage + 1}
            >
              <span className="reader-page-indicator-text">
                {currentPage + 1} / {totalPages}
              </span>
              <input
                type="range"
                className="reader-page-indicator-bar"
                min={0}
                max={totalPages - 1}
                value={Math.min(currentPage, totalPages - 1)}
                onChange={(e) => {
                  const container = contentRef.current;
                  if (!container) return;
                  const idx = parseInt(e.target.value, 10);
                  container.scrollTo({
                    left: idx * (pageWidth || container.clientWidth),
                    behavior: 'smooth',
                  });
                }}
                aria-label="Прогресс по главе"
              />
            </div>
          </>
        )}
      </div>

      {glossaryPopover && (
        <div
          className="glossary-popover"
          style={{
            left: glossaryPopover.x,
            top: glossaryPopover.y,
          }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
        >
          <div className="glossary-popover-term">
            {glossaryPopover.item.term_original}
          </div>
          <div className="glossary-popover-translation">
            {glossaryPopover.item.term_translation}
          </div>
          {glossaryPopover.item.category && (
            <div className="glossary-popover-category">
              {labelForCategory(glossaryPopover.item.category)}
            </div>
          )}
        </div>
      )}

      <QuoteBubble
        novelId={novelId}
        chapterNumber={chapterNumber}
        containerRef={contentRef}
        novelFirebaseId={novelFirebaseId}
        novelTitle={novelTitle}
      />

      <ReaderSettingsPanel
        open={settingsOpen}
        settings={settings}
        onChange={updateSettings}
        onClose={() => setSettingsOpen(false)}
        selectedPreset={selectedPreset}
        sleepMinLeft={sleepMinLeft}
        onSleepTimerSet={(m) => {
          setSelectedPreset(m);
          setSleepDismissed(false);
        }}
      />

      {sleepExpired && !sleepDismissed && (
        <SleepTimerOverlay
          onExtend={(extra) => {
            setSelectedPreset(extra);
            setSleepDismissed(true);
          }}
          onDismiss={() => {
            setSleepDismissed(true);
            setSelectedPreset(null);
          }}
        />
      )}

      <style jsx global>{`
        .novel-content p,
        .novel-content blockquote {
          margin-top: ${settings.paragraphSpacing}em;
          margin-bottom: ${settings.paragraphSpacing}em;
          text-indent: ${settings.textIndent}em;
        }
        .novel-content h1,
        .novel-content h2,
        .novel-content h3 {
          text-indent: 0;
          margin-top: 2em;
          margin-bottom: 1em;
        }
        .novel-content i,
        .novel-content em {
          font-style: italic;
        }
        .novel-content blockquote {
          border-left: 3px solid var(--accent-soft);
          padding-left: 1em;
          color: var(--ink-soft);
          font-style: italic;
        }
      `}</style>
    </div>
  );
}
