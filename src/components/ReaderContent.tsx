'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createClient } from '@/utils/supabase/client';
import {
  loadSettings,
  saveSettings,
  fetchServerSettings,
  pushServerSettings,
  getFontCss,
  DEFAULT_SETTINGS,
  type ReaderSettings,
} from '@/lib/reader';
import ReaderSettingsPanel from './ReaderSettings';
import QuoteBubble from './QuoteBubble';
import SleepTimerOverlay from './SleepTimerOverlay';
import ChapterTOC from './reader/ChapterTOC';
import ReaderBottomBar from './reader/ReaderBottomBar';

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
  prevChapterNumber?: number | null;
  nextChapterNumber?: number | null;
  /** Что показать ПОСЛЕ текста главы: «Спасибо», «Дневник», «Письмо
      переводчику» + комментарии. В pages-режиме — последняя snap-страница
      в горизонтальном scroller'е (свайпом доходишь, как в книге);
      в scroll-режиме — просто ниже текста. */
  commentsSlot?: React.ReactNode;
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

// Главы из tene приходят с «легаси»-сносками: <p>[N] определение</p> без
// каких-либо классов (или с ушедшими в небытие tailwind-классами под
// дизайн tene). chaptify рендерит их через .fn-inline в globals.css —
// добавляем этот класс рантаймом, не трогая HTML в storage. Это
// гарантирует, что одна и та же глава корректно отображается и на tene
// (со своей разметкой), и на chaptify (со своими классами).
//
// Идемпотентно: если на абзаце уже стоит .fn-inline (например, добавили
// через chaptify-админку BB-тегом [fn] или прогнали migrate-footnotes.mjs),
// ничего не меняем.
function injectLegacyFootnoteClasses(html: string): string {
  if (!html) return '';
  return html.replace(
    /<p\b([^>]*)>(\s*(?:<[^>]+>\s*)*\[\d+\][\s\S]*?)<\/p>/gi,
    (match, attrs: string, body: string) => {
      if (/\bclass\s*=\s*["'][^"']*\bfn-inline\b/.test(attrs)) return match;
      if (/\bclass\s*=\s*["']/.test(attrs)) {
        const next = attrs.replace(
          /(\bclass\s*=\s*["'])/,
          (_m, p1) => `${p1}fn-inline `,
        );
        return `<p${next}>${body}</p>`;
      }
      return `<p class="fn-inline"${attrs}>${body}</p>`;
    },
  );
}

export default function ReaderContent({
  content,
  novelId,
  chapterNumber,
  glossary = [],
  novelFirebaseId,
  novelTitle,
  prevChapterNumber = null,
  nextChapterNumber = null,
  commentsSlot = null,
}: Props) {
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);

  // Таймер сна.
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [sleepMinLeft, setSleepMinLeft] = useState<number | null>(null);
  const [sleepExpired, setSleepExpired] = useState(false);
  const [sleepDismissed, setSleepDismissed] = useState(false);

  const contentRef = useRef<HTMLDivElement | null>(null);
  // В pages-режиме «scroller» — это outer flex-контейнер с реальными
  // CSS scroll-snap targets (страница-контент + spacer'ы). В scroll-режиме
  // outer не используется — вертикальный скролл идёт через window.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  // iOS/Android уносят scrollLeft overflow-контейнера при блокировке экрана —
  // запоминаем последнюю позицию и восстанавливаем при возврате на вкладку.
  const savedScrollRef = useRef<{ top: number; left: number }>({ top: 0, left: 0 });
  // На странице обсуждения пользователь тапает по textarea — iOS поднимает
  // клавиатуру, layout вокруг ужимается, ResizeObserver срабатывает и
  // пересчитывает количество страниц / spacer'ов → DOM перетряхивается → snap
  // утаскивает scrollLeft на ближайший snap-target (обычно последняя текстовая
  // страница). Решение: пока внутри scroller'а сфокусирован input — флаг true,
  // и calc/RO-эффект полностью игнорирует ресайзы.
  const inputFocusedRef = useRef<boolean>(false);

  // Для CSS-каскада: пока юзер в pages-режиме, на body висит класс
  // .reader-pages-mode. Используется чтобы скрыть глобальный SiteHeader
  // и применить visibility-hide к ReaderBottomBar при открытой клавиатуре.
  // Через body-класс (не через CSS :has) чтобы работало на любом WebView.
  useEffect(() => {
    if (settings.readMode === 'pages') {
      document.body.classList.add('reader-pages-mode');
      return () => document.body.classList.remove('reader-pages-mode');
    }
  }, [settings.readMode]);

  // Детектим открытую клавиатуру через visualViewport и сигналим CSS.
  // На iOS position: fixed элементы привязаны к visual viewport, поэтому
  // ReaderBottomBar «прилипает» к верху клавиатуры. Прячем её через CSS
  // когда детектим что viewport ужался > 100px относительно layout.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const check = () => {
      const isKeyboardOpen = vv.height < window.innerHeight - 100;
      document.body.classList.toggle('reader-keyboard-up', isKeyboardOpen);
    };
    check();
    vv.addEventListener('resize', check);
    return () => {
      vv.removeEventListener('resize', check);
      document.body.classList.remove('reader-keyboard-up');
    };
  }, []);

  const [pageWidth, setPageWidth] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [scrollPercent, setScrollPercent] = useState(0);

  const [commentCount, setCommentCount] = useState<number | null>(null);
  const [uiHidden, setUiHidden] = useState(false);

  const processedContent = useMemo(
    () => injectLegacyFootnoteClasses(content),
    [content],
  );

  // ---- 1. Загрузка настроек ----
  useEffect(() => {
    setSettings(loadSettings());
    setReady(true);
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const fromServer = await fetchServerSettings(supabase);
        if (!cancelled && fromServer) {
          setSettings(fromServer);
          saveSettings(fromServer);
        }
      } catch { /* network — игнорим, остаёмся на локальных */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // ---- 2. Автосохранение настроек ----
  const settingsPushTimer = useRef<number | null>(null);
  const updateSettings = useCallback((next: ReaderSettings) => {
    setSettings(next);
    saveSettings(next);
    if (settingsPushTimer.current != null) {
      window.clearTimeout(settingsPushTimer.current);
    }
    settingsPushTimer.current = window.setTimeout(() => {
      const supabase = createClient();
      pushServerSettings(supabase, next).catch(() => { /* ignore */ });
    }, 600);
  }, []);

  // ---- 3. Горячие клавиши (A+/A-) ----
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
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [settings, updateSettings]);

  // ---- 4. Сохранение прогресса чтения ----
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

      await supabase.rpc('update_my_profile', {
        data_to_update: { last_read: updated },
      });

      supabase.rpc('log_reading_day').then(() => {}, () => {});
    },
    [novelId, chapterNumber]
  );

  // ---- 4.5. Inline-глоссарий ----
  const [glossaryPopover, setGlossaryPopover] = useState<null | {
    x: number;
    y: number;
    item: GlossaryItem;
  }>(null);

  // Поповер сноски переводчика (когда настройка footnotePopover === true)
  const [fnPopover, setFnPopover] = useState<null | {
    x: number;
    y: number;
    n: string;
    text: string;
  }>(null);

  useEffect(() => {
    if (!ready) return;
    const container = contentRef.current;
    if (!container || glossary.length === 0) return;

    const sortedTerms = [...glossary].sort(
      (a, b) => b.term_original.length - a.term_original.length
    );
    const lookup = new Map<string, GlossaryItem>();
    for (const g of sortedTerms) lookup.set(g.term_original.toLowerCase(), g);

    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = sortedTerms.map((g) => escape(g.term_original)).join('|');
    if (!pattern) return;
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}])(${pattern})(?![\\p{L}\\p{N}])`,
      'giu'
    );

    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
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

  // ---- 4.6. Сноски переводчика ----
  // Делегированный клик по .fn-ref. Поведение зависит от настройки:
  // - off (default) — плавный скролл к <p id="fn-N"> + кратковременная подсветка
  // - on            — открываем плавающую карточку с текстом сноски
  useEffect(() => {
    if (!ready) return;
    const container = contentRef.current;
    if (!container) return;

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const ref = target?.closest('.fn-ref') as HTMLElement | null;
      if (!ref || !container.contains(ref)) return;

      const n = ref.getAttribute('data-fn-id');
      if (!n) return;

      const inline = container.querySelector<HTMLElement>(`#fn-${CSS.escape(n)}`);
      if (!inline) return;

      e.preventDefault();
      e.stopPropagation();

      if (settings.footnotePopover) {
        // Вытаскиваем текст без ведущего <sup>N</sup>
        const clone = inline.cloneNode(true) as HTMLElement;
        const lead = clone.querySelector('sup');
        if (lead) lead.remove();
        const text = clone.textContent?.trim() ?? '';
        const rect = ref.getBoundingClientRect();
        // Позиционируем поповер под маркером, прижимая к правому/левому краю
        const popoverWidth = 320;
        const margin = 8;
        const vw = window.innerWidth;
        const x = Math.min(
          Math.max(margin, rect.left + rect.width / 2 - popoverWidth / 2),
          vw - popoverWidth - margin,
        );
        const y = rect.bottom + 6;
        setFnPopover({ x, y, n, text });
      } else {
        inline.scrollIntoView({ behavior: 'smooth', block: 'center' });
        inline.classList.remove('fn-flash');
        // forced reflow, чтобы анимация перезапускалась при повторных тапах
        void inline.offsetWidth;
        inline.classList.add('fn-flash');
        window.setTimeout(() => inline.classList.remove('fn-flash'), 1700);
      }
    };

    container.addEventListener('click', onClick);

    const onDocClick = () => setFnPopover(null);
    document.addEventListener('click', onDocClick);
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFnPopover(null);
    };
    document.addEventListener('keydown', onEsc);

    return () => {
      container.removeEventListener('click', onClick);
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [ready, content, settings.footnotePopover]);

  // ---- 5. Отслеживание активного абзаца + сохранение прогресса ----
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
      // В pages-режиме скролл — на outer scroller'е (snap-flex-контейнер).
      // А абзацы лежат внутри inner-content'а (multi-column). offsetLeft
      // абзаца отсчитан относительно content'а, поэтому сравниваем с
      // scroller.scrollLeft напрямую — это та же координатная система
      // (content начинается с 0 в outer'е, multi-col-колонки идут
      // pageWidth-шагом).
      const sc = scrollerRef.current;
      if (!sc) return 0;
      const scrollLeft = sc.scrollLeft;
      const pageW = sc.clientWidth || 1;
      let bestIdx = 0;
      for (let i = 0; i < paragraphs.length; i++) {
        const el = paragraphs[i];
        if (el.offsetLeft + el.offsetWidth >= scrollLeft + 1) {
          bestIdx = i;
          if (el.offsetLeft >= scrollLeft) break;
        }
        if (el.offsetLeft > scrollLeft + pageW) break;
      }
      return bestIdx;
    };

    const applyActive = (bestIdx: number) => {
      if (bestIdx === lastActiveId) return;
      lastActiveId = bestIdx;
    };

    const onAnyScroll = () => {
      const best = isPages ? findBestPaged() : findBestVertical();
      applyActive(best);
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => saveProgress(best), 1500);
    };

    applyActive(isPages ? findBestPaged() : findBestVertical());

    // В pages-режиме слушаем outer scroller, в scroll — window.
    const scrollTarget: EventTarget = isPages
      ? (scrollerRef.current ?? window)
      : window;
    scrollTarget.addEventListener('scroll', onAnyScroll, { passive: true });

    return () => {
      scrollTarget.removeEventListener('scroll', onAnyScroll);
      // На размонтировании или смене readMode сразу сбрасываем
      // отложенный save и пишем прогресс синхронно: иначе при
      // переключении «свиток ↔ страницы» 1.5-секундный debounce
      // съедает последнее положение, и новый режим восстанавливает
      // позицию из state'а до последнего скролла.
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (lastActiveId >= 0) {
        saveProgress(lastActiveId);
      }
    };
  }, [ready, content, saveProgress, settings.readMode]);

  // ---- 6. Восстановление позиции при заходе в главу ----
  useEffect(() => {
    if (!ready) return;
    const container = contentRef.current;
    if (!container) return;

    const jumpToEnd = () => {
      setTimeout(() => {
        if (settings.readMode === 'pages') {
          // Сначала листаем книгу к концу — последняя текстовая страница;
          // потом доскроллим body вниз, чтобы ушло в обсуждение
          // (которое теперь лежит flow-блоком под scroller'ом).
          const sc = scrollerRef.current;
          if (sc) {
            sc.scrollTo({
              left: sc.scrollWidth,
              behavior: 'instant' as ScrollBehavior,
            });
          }
          window.scrollTo({
            top: document.body.scrollHeight,
            behavior: 'instant' as ScrollBehavior,
          });
        } else {
          window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' as ScrollBehavior });
        }
      }, 160);
    };

    const params = new URLSearchParams(window.location.search);
    if (params.get('end') === '1') {
      jumpToEnd();
      return;
    }

    let cancelled = false;
    type ProgressEntry = {
      chapterId: number;
      paragraphIndex?: number;
      timestamp?: string;
    };
    const restoreTo = (data: ProgressEntry) => {
      if (data.chapterId !== chapterNumber) return;
      const idx = data.paragraphIndex ?? 0;
      const paragraphs = container.querySelectorAll<HTMLElement>(
        'p, h1, h2, h3, blockquote'
      );
      const target = paragraphs[idx];
      if (!target) return;
      if (settings.readMode === 'pages') {
        const sc = scrollerRef.current;
        const pageW = sc?.clientWidth ?? 0;
        if (sc && pageW > 0) {
          // target.offsetLeft в pages-режиме отражает позицию абзаца
          // внутри multi-column ВНУТРИ content-div'а. Колонки идут по
          // pageW, gap=0, так что floor(offsetLeft / pageW) = индекс колонки.
          const pageIdx = Math.floor(target.offsetLeft / pageW);
          sc.scrollTo({
            left: pageIdx * pageW,
            behavior: 'instant' as ScrollBehavior,
          });
        }
      } else {
        target.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
      }
    };

    let localData: ProgressEntry | null = null;
    try {
      const raw = localStorage.getItem(`progress_${novelId}`);
      if (raw) localData = JSON.parse(raw) as ProgressEntry;
    } catch { /* ignore */ }

    if (localData) {
      setTimeout(() => { if (!cancelled) restoreTo(localData!); }, 160);
    }

    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: profile } = await supabase
          .from('profiles')
          .select('last_read')
          .eq('id', user.id)
          .maybeSingle();
        if (cancelled) return;
        const lr = (profile?.last_read ?? {}) as Record<string, ProgressEntry>;
        const serverData = lr[String(novelId)];
        if (!serverData) return;
        const localTs = localData?.timestamp ? Date.parse(localData.timestamp) : 0;
        const serverTs = serverData.timestamp ? Date.parse(serverData.timestamp) : 0;
        if (serverTs >= localTs) {
          try {
            localStorage.setItem(
              `progress_${novelId}`,
              JSON.stringify(serverData)
            );
          } catch { /* ignore */ }
          setTimeout(() => { if (!cancelled) restoreTo(serverData); }, 220);
        }
      } catch { /* offline / RLS */ }
    })();

    return () => { cancelled = true; };
  }, [ready, content, novelId, chapterNumber, settings.readMode]);

  // ---- 6.5. Pages mode: расчёт totalPages + currentPage ----
  useEffect(() => {
    if (!ready) return;
    if (settings.readMode !== 'pages') {
      setPageWidth(0);
      setCurrentPage(0);
      setTotalPages(1);
      const c = contentRef.current;
      if (c) c.style.columnWidth = '';
      return;
    }
    const content = contentRef.current;
    const scroller = scrollerRef.current;
    if (!content || !scroller) return;

    const calc = () => {
      const w = scroller.clientWidth;
      if (!w) return;
      // Multi-column на content-div'е: column-width = pageWidth даёт по
      // одной колонке на ширину рендер-бокса. Контент перетекает в
      // следующие колонки, которые рендерятся ВПРАВО за пределы бокса
      // (overflow visible). Outer flex-scroller со spacer'ами одной
      // ширины делает их видимыми и снапаемыми.
      content.style.width = `${w}px`;
      content.style.columnWidth = `${w}px`;
      setPageWidth(w);
      requestAnimationFrame(() => {
        // scrollWidth content'а = ширина одной колонки * число колонок.
        // Берём именно его (а не scroller.scrollWidth, потому что spacer'ы
        // ещё не подтянулись после первого расчёта).
        const sw = Math.max(0, content.scrollWidth - 2);
        const total = Math.max(1, Math.ceil(sw / w));
        // Обсуждение теперь живёт ниже scroller'а как обычный flow,
        // в счёт страниц-листалки не входит — счётчик «X из Y»
        // считает только текстовые страницы.
        setTotalPages((prev) => (prev === total ? prev : total));
      });
    };

    // 1. Первый расчёт после монтирования
    const initialTimer = window.setTimeout(calc, 80);

    // 2. После загрузки шрифтов (web-fonts сильно меняют ширину текста)
    const fontsReady = document.fonts?.ready;
    if (fontsReady) fontsReady.then(calc).catch(calc);

    // 3. Reflow при изменении ширины ИЛИ высоты контейнера. Высота
    //    меняется когда iOS Safari прячет адресную строку или когда
    //    клавиатура выезжает — multi-column перетекает, totalPages меняется.
    //    ВАЖНО: пока в фокусе input/textarea (страница обсуждения), ВООБЩЕ
    //    игнорируем ресайзы — иначе iOS-клавиатура триггерит recalc → DOM
    //    перетряхивается → snap утаскивает пользователя с обсуждения.
    let lastWidth = scroller.clientWidth;
    let lastHeight = scroller.clientHeight;
    const ro = new ResizeObserver((entries) => {
      if (inputFocusedRef.current) return;
      for (const e of entries) {
        const w = Math.round(e.contentRect.width);
        const h = Math.round(e.contentRect.height);
        if (Math.abs(w - lastWidth) > 0.5 || Math.abs(h - lastHeight) > 0.5) {
          lastWidth = w;
          lastHeight = h;
          calc();
        }
      }
    });
    ro.observe(scroller);

    // 4. Картинки внутри главы: каждая загруженная меняет column flow.
    const imgs = content.querySelectorAll('img');
    const onImg = () => {
      if (inputFocusedRef.current) return;
      calc();
    };
    imgs.forEach((img) => {
      if (img.complete) return;
      img.addEventListener('load', onImg);
      img.addEventListener('error', onImg);
    });

    let rafId: number | null = null;
    const onScroll = () => {
      // Сохраняем позицию для visibilitychange-восстановления
      savedScrollRef.current = {
        top: scroller.scrollTop,
        left: scroller.scrollLeft,
      };
      if (rafId != null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const w = scroller.clientWidth || 1;
        const next = Math.round(scroller.scrollLeft / w);
        setCurrentPage((prev) => (prev === next ? prev : next));
      });
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      window.clearTimeout(initialTimer);
      ro.disconnect();
      scroller.removeEventListener('scroll', onScroll);
      imgs.forEach((img) => {
        img.removeEventListener('load', onImg);
        img.removeEventListener('error', onImg);
      });
      if (rafId != null) cancelAnimationFrame(rafId);
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

  // ---- 6.55. Scroll-mode: вычисляем процент прогресса для нижней панели ----
  useEffect(() => {
    if (!ready || settings.readMode === 'pages') {
      setScrollPercent(0);
      return;
    }
    let rafId: number | null = null;
    const onScroll = () => {
      if (rafId != null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        // window.scrollY относительно body. Делим на «реальный» max-scroll
        // (высота документа − высота viewport).
        const max = Math.max(
          1,
          document.documentElement.scrollHeight - window.innerHeight
        );
        const pct = Math.max(0, Math.min(100, (window.scrollY / max) * 100));
        setScrollPercent((prev) => (Math.abs(prev - pct) < 0.5 ? prev : pct));
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [ready, settings.readMode]);

  // ---- 6.56. visibilitychange: iOS/Android уносят scrollLeft в фоне ----
  useEffect(() => {
    if (!ready || settings.readMode !== 'pages') return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        savedScrollRef.current = {
          top: scroller.scrollTop,
          left: scroller.scrollLeft,
        };
      } else {
        const { top, left } = savedScrollRef.current;
        if (top > 0 || left > 0) {
          requestAnimationFrame(() => {
            scroller.scrollTo({ top, left, behavior: 'instant' as ScrollBehavior });
          });
        }
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [ready, settings.readMode]);

  // ---- 6.57. iOS keyboard / input focus в pages-режиме ----
  // С тех пор как обсуждение лежит обычным flow-блоком ниже scroller'а,
  // iOS сам поднимает focused input в видимую часть. Нам остаётся
  // только защититься от двух старых проблем:
  //   • когда юзер фокусируется в textarea (комментарий), клавиатура
  //     может ужать viewport → ResizeObserver на scroller стреляет →
  //     totalPages пересчитывается → snap утаскивает читателя.
  //     Лечим: inputFocusedRef = true, calc/RO игнорят ресайзы (см. выше).
  //   • iOS внезапно дёргает scrollLeft scroller'а в неожиданное место
  //     при появлении клавиатуры. Лечим: snap-type = none, и watcher,
  //     который возвращает scrollLeft к сохранённому savedLeft.
  useEffect(() => {
    if (!ready || settings.readMode !== 'pages') return;
    const scroller = scrollerRef.current;
    if (!scroller) return;

    let savedLeft = 0;

    const isEditable = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      return !!el.closest('input, textarea, select, [contenteditable="true"]');
    };

    let restoring = false;
    const onScroll = () => {
      if (!inputFocusedRef.current) return;
      if (restoring) return;
      if (Math.abs(scroller.scrollLeft - savedLeft) < 2) return;
      restoring = true;
      scroller.scrollTo({ left: savedLeft, behavior: 'instant' as ScrollBehavior });
      requestAnimationFrame(() => { restoring = false; });
    };

    // С тех пор как обсуждение переехало из snap-цепочки в обычный flow
    // ниже scroller'а, manual-scroll внутри контейнера больше не нужен —
    // iOS сам поднимает focused input в visualViewport. Оставляем
    // только: фиксацию флага inputFocusedRef (его смотрит ResizeObserver,
    // чтобы не пересчитывать totalPages, пока юзер пишет коммент) и
    // защёлку на горизонтальный snap, чтобы клавиатура не утаскивала
    // текущую страницу-листалку.

    const onFocusIn = (e: FocusEvent) => {
      if (!isEditable(e.target)) return;
      savedLeft = scroller.scrollLeft;
      inputFocusedRef.current = true;
      scroller.style.scrollSnapType = 'none';
      scroller.addEventListener('scroll', onScroll, { passive: true });
    };
    const onFocusOut = (e: FocusEvent) => {
      if (!isEditable(e.target)) return;
      // Фокус ушёл на другой редактор — сохраняем флаг.
      const next = e.relatedTarget as HTMLElement | null;
      if (next && isEditable(next)) {
        savedLeft = scroller.scrollLeft;
        return;
      }
      inputFocusedRef.current = false;
      scroller.removeEventListener('scroll', onScroll);
      scroller.style.scrollSnapType = '';
      if (Math.abs(scroller.scrollLeft - savedLeft) > 4) {
        requestAnimationFrame(() => {
          scroller.scrollTo({ left: savedLeft, behavior: 'instant' as ScrollBehavior });
        });
      }
    };

    // Слушаем focus на уровне document — input теперь может жить и в
    // scroller'е (теоретически), и в .reader-pages-end вне его.
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      scroller.removeEventListener('scroll', onScroll);
      scroller.style.scrollSnapType = '';
      inputFocusedRef.current = false;
    };
  }, [ready, settings.readMode]);

  // ---- 6.6. Keyboard nav в pages-режиме ----
  useEffect(() => {
    if (!ready) return;
    if (settings.readMode !== 'pages') return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const isTextInput =
        (e.target instanceof HTMLInputElement && e.target.type !== 'range') ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable);
      if (isTextInput) return;
      // Если фокус на range — даём слайдеру самому отработать стрелку
      // (избегаем двойной перемотки), но Home/End/PageUp/PageDown берём.
      const onRange = tag === 'INPUT' && (e.target as HTMLInputElement).type === 'range';
      const w = scroller.clientWidth;
      if (!w) return;
      const idx = Math.round(scroller.scrollLeft / w);
      const maxIdx = Math.max(0, Math.round(scroller.scrollWidth / w) - 1);
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        if (onRange && e.key === 'ArrowRight') return;
        e.preventDefault();
        const t = Math.min(maxIdx, idx + 1);
        scroller.scrollTo({ left: t * w, behavior: 'smooth' });
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        if (onRange && e.key === 'ArrowLeft') return;
        e.preventDefault();
        const t = Math.max(0, idx - 1);
        scroller.scrollTo({ left: t * w, behavior: 'smooth' });
      } else if (e.key === 'Home') {
        e.preventDefault();
        scroller.scrollTo({ left: 0, behavior: 'smooth' });
      } else if (e.key === 'End') {
        e.preventDefault();
        scroller.scrollTo({ left: scroller.scrollWidth, behavior: 'smooth' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ready, settings.readMode]);

  // ---- 6.7. Smart tap/click navigation ----
  const flipBusyRef = useRef(false);
  const onContentClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // КРИТИЧНО: если пользователь только что выделил текст (для цитаты),
      // mouseup попадает в этот хэндлер. В pages-режиме клик в левом 33%
      // экрана = перелистывание назад → текст «съезжает», выделение
      // теряется. Проверяем selection ДО любой логики и выходим.
      const sel = typeof window !== 'undefined' ? window.getSelection() : null;
      if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
        return;
      }

      // В scroll-режиме тоже работаем — тап по центру скрывает/показывает
      // нижнюю панель (UI-immersive mode для скролла, как в pages).
      const target = e.target as HTMLElement;
      if (
        target.closest(
          'a, button, input, textarea, select, [contenteditable="true"], .glossary-term, .quote-bubble'
        )
      ) {
        return;
      }

      if (settings.readMode !== 'pages') {
        // В скролл-режиме нет «зон перелистывания» — любой пустой клик
        // переключает immersive-режим (скрывает/показывает нижнюю
        // sticky-панель прогресса/настроек).
        setUiHidden((v) => !v);
        return;
      }

      const scroller = scrollerRef.current;
      if (!scroller) return;
      const w = scroller.clientWidth;
      if (!w) return;
      const rect = scroller.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const isEdgeTap = x < w * 0.33 || x > w * 0.67;
      if (isEdgeTap) {
        if (flipBusyRef.current) return;
        flipBusyRef.current = true;
        const idx = Math.round(scroller.scrollLeft / w);
        const dir = x < w * 0.33 ? -1 : 1;
        const maxIdx = Math.max(0, Math.round(scroller.scrollWidth / w) - 1);
        const targetIdx = Math.max(0, Math.min(maxIdx, idx + dir));
        scroller.scrollTo({ left: targetIdx * w, behavior: 'smooth' });
        setTimeout(() => { flipBusyRef.current = false; }, 320);
      } else {
        setUiHidden((v) => !v);
      }
    },
    [settings.readMode]
  );

  const scrollPageBy = useCallback(
    (direction: 1 | -1) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const w = scroller.clientWidth;
      if (!w) return;
      const idx = Math.round(scroller.scrollLeft / w);
      const maxIdx = Math.max(0, Math.round(scroller.scrollWidth / w) - 1);
      const t = Math.max(0, Math.min(maxIdx, idx + direction));
      scroller.scrollTo({ left: t * w, behavior: 'smooth' });
    },
    []
  );

  // ---- 6.75. Visibility-save ----
  useEffect(() => {
    if (!ready) return;
    const container = contentRef.current;
    if (!container) return;
    const paragraphs = container.querySelectorAll<HTMLElement>('p, h1, h2, h3, blockquote');

    const findCurrent = (): number => {
      if (settings.readMode !== 'pages') {
        const mid = window.innerHeight / 2;
        let best = 0, bestDist = Infinity;
        paragraphs.forEach((el, i) => {
          const r = el.getBoundingClientRect();
          const m = r.top + r.height / 2;
          const d = Math.abs(m - mid);
          if (d < bestDist) { bestDist = d; best = i; }
        });
        return best;
      }
      // В pages-режиме скролл — на outer scroller'е, не на content.
      const sl = scrollerRef.current?.scrollLeft ?? 0;
      for (let i = 0; i < paragraphs.length; i++) {
        if (paragraphs[i].offsetLeft + paragraphs[i].offsetWidth >= sl + 1) return i;
      }
      return paragraphs.length - 1;
    };

    let lastSavedIdx = -1;
    const flushSave = () => {
      if (paragraphs.length === 0) return;
      const idx = findCurrent();
      if (idx === lastSavedIdx) return;
      lastSavedIdx = idx;
      saveProgress(idx);
    };

    const onHide = () => {
      if (document.visibilityState === 'hidden') flushSave();
    };
    const onPageHide = () => flushSave();

    const periodicId = window.setInterval(flushSave, 30_000);

    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      window.clearInterval(periodicId);
    };
  }, [ready, saveProgress, settings.readMode]);

  // ---- 6.8. Comments count для бейджа ----
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

  const scrollToComments = useCallback(() => {
    // Раньше в pages-режиме комменты были последней snap-страницей,
    // и мы просто скроллили scroller к правому краю. Теперь они
    // лежат обычным flow-блоком ниже scroller'а — в обоих режимах
    // достаточно scrollIntoView на саму секцию.
    const sec = document.querySelector('.comments-section');
    if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // ---- 7. Таймер сна ----
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
      className={`reader-wrapper${uiHidden ? ' ui-hidden' : ''}`}
      data-theme={settings.theme ?? 'light'}
      data-read-mode={settings.readMode ?? 'scroll'}
    >
      {/* Старый верхний reader-toolbar убран — управление переехало в
          sticky-панель снизу (ReaderBottomBar), как в tene. */}

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

      {settings.readMode === 'pages' ? (
        // Outer flex-scroller — реальный CSS scroll-snap. Каждый flex-item
        // (контент-страница и spacer'ы по числу страниц - 1) имеет
        // scroll-snap-align: start, поэтому браузер сам цепко
        // фиксирует страницу на отпускании пальца — без JS-доводок.
        // Multi-column рендерится внутри content-страницы (width = pageWidth)
        // с overflow-visible: колонки 2..N визуально перетекают вправо
        // поверх spacer'ов, и пользователь видит их при свайпе.
        //
        // ВАЖНО: блок обсуждения (commentsSlot) рендерится НЕ ВНУТРИ
        // scroller'а, а как отдельный flow-блок ниже. Раньше он жил
        // последним snap-target'ом с собственным overflow-y, и юзеры
        // жаловались на «page in page» — внутренний скролл внутри
        // листателя. Теперь scroller занимает первый экран (книга),
        // а вертикальный скролл сайта естественно уводит читателя
        // в обсуждение, как в scroll-режиме.
        <>
          <div
            ref={scrollerRef}
            className="reader-pages-scroller"
            onClick={onContentClick}
          >
            <div
              ref={contentRef}
              className="novel-content reader-pages-content"
              style={bodyStyle}
              dangerouslySetInnerHTML={{ __html: processedContent }}
            />
            {/* spacer'ы дают snap-targets для колонок 2..N (одна на каждый
                текстовый «лист» помимо первого, который рендерит сама content-page). */}
            {Array.from({
              length: Math.max(0, totalPages - 1),
            }).map((_, i) => (
              <div
                key={`pm-spacer-${i}`}
                className="reader-pages-spacer"
                style={{ width: pageWidth || '100%' }}
                aria-hidden="true"
              />
            ))}
          </div>
          {commentsSlot && (
            <div className="reader-pages-end">{commentsSlot}</div>
          )}
        </>
      ) : (
        <div className="novel-content-host">
          <div
            ref={contentRef}
            className="novel-content"
            style={bodyStyle}
            onClick={onContentClick}
            dangerouslySetInnerHTML={{ __html: processedContent }}
          />
        </div>
      )}

      {/* В scroll-режиме комменты — обычный flow-блок под текстом.
          В pages — рендерятся выше как сосед scroller'а, второй раз не показываем. */}
      {settings.readMode !== 'pages' && commentsSlot}

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

      {fnPopover && (
        <div
          className="fn-popover"
          style={{
            left: fnPopover.x,
            top: fnPopover.y,
          }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
        >
          <button
            type="button"
            className="fn-popover-close"
            onClick={() => setFnPopover(null)}
            aria-label="Закрыть"
          >
            ×
          </button>
          <span className="fn-popover-num">{fnPopover.n}</span>
          {fnPopover.text}
        </div>
      )}

      <QuoteBubble
        novelId={novelId}
        chapterNumber={chapterNumber}
        containerRef={contentRef}
        novelFirebaseId={novelFirebaseId}
        novelTitle={novelTitle}
      />

      <ReaderBottomBar
        readMode={settings.readMode === 'pages' ? 'pages' : 'scroll'}
        currentPage={currentPage}
        totalPages={totalPages}
        scrollPercent={scrollPercent}
        novelFirebaseId={novelFirebaseId ?? null}
        prevChapterNumber={prevChapterNumber}
        nextChapterNumber={nextChapterNumber}
        onSeekPage={(idx) => {
          const sc = scrollerRef.current;
          if (!sc) return;
          sc.scrollTo({
            left: idx * (pageWidth || sc.clientWidth),
            behavior: 'smooth',
          });
        }}
        onSeekScroll={(percent) => {
          const max = Math.max(
            1,
            document.documentElement.scrollHeight - window.innerHeight
          );
          window.scrollTo({
            top: (percent / 100) * max,
            behavior: 'smooth',
          });
        }}
        onPrevPage={() => scrollPageBy(-1)}
        onNextPage={() => scrollPageBy(1)}
        onOpenTOC={() => setTocOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onJumpToComments={scrollToComments}
        commentCount={commentCount}
        // На последней странице (обсуждение) bottom-bar не нужна:
        // там свои кнопки next-chapter / комменты / textarea, а
        // фиксированная панель снизу только мешает (на iOS лезет
        // над клавиатурой полупрозрачной полосой). Прячем её ровно
        // на этой странице — на текстовых остаётся как было.
        visible={
          !uiHidden &&
          !(
            settings.readMode === 'pages' &&
            commentsSlot != null &&
            currentPage >= totalPages - 1
          )
        }
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
