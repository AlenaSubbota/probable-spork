'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
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
  prevChapterNumber = null,
  nextChapterNumber = null,
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
  const saveTimerRef = useRef<number | null>(null);
  // iOS/Android уносят scrollLeft overflow-контейнера при блокировке экрана —
  // запоминаем последнюю позицию и восстанавливаем при возврате на вкладку.
  const savedScrollRef = useRef<{ top: number; left: number }>({ top: 0, left: 0 });

  const [pageWidth, setPageWidth] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [scrollPercent, setScrollPercent] = useState(0);

  const [commentCount, setCommentCount] = useState<number | null>(null);
  const [uiHidden, setUiHidden] = useState(false);

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

  // ---- 3. Горячие клавиши (A+/A-/F = focus) ----
  // F работает только в scroll-режиме — фокус-режим отключён в pages
  // (см. toolbar ниже).
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
        if (settings.readMode !== 'pages') {
          updateSettings({ ...settings, focusMode: !settings.focusMode });
        }
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
      const scrollLeft = container.scrollLeft;
      const pageW = container.clientWidth || 1;
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

  // ---- 6. Восстановление позиции при заходе в главу ----
  useEffect(() => {
    if (!ready) return;
    const container = contentRef.current;
    if (!container) return;

    const jumpToEnd = () => {
      setTimeout(() => {
        if (settings.readMode === 'pages') {
          container.scrollTo({
            left: container.scrollWidth,
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
        const pageW = container.clientWidth;
        if (pageW > 0) {
          const pageIdx = Math.floor(target.offsetLeft / pageW);
          container.scrollTo({
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
    const container = contentRef.current;
    if (!container) return;

    const calc = () => {
      const w = container.clientWidth;
      if (!w) return;
      container.style.columnWidth = `${w}px`;
      setPageWidth(w);
      requestAnimationFrame(() => {
        // Math.ceil вместо round — иначе при scrollWidth=2.7w totalPages=3
        // (правильно), но при scrollWidth=2.4w было бы 2 → последний 0.4w
        // контента вообще нескроллируемый. Маленькая погрешность 1px
        // (sub-pixel rendering) не должна давать лишнюю пустую страницу:
        // вычитаем 2px перед делением.
        const sw = Math.max(0, container.scrollWidth - 2);
        const total = Math.max(1, Math.ceil(sw / w));
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
    let lastWidth = container.clientWidth;
    let lastHeight = container.clientHeight;
    const ro = new ResizeObserver((entries) => {
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
    ro.observe(container);

    // 4. Картинки внутри главы: каждая загруженная меняет column flow.
    //    Без этого первая страница может остаться пустой, пока картинки
    //    тянутся — totalPages посчитается до их прихода.
    const imgs = container.querySelectorAll('img');
    const onImg = () => calc();
    imgs.forEach((img) => {
      if (img.complete) return;
      img.addEventListener('load', onImg);
      img.addEventListener('error', onImg);
    });

    let rafId: number | null = null;
    const onScroll = () => {
      // Сохраняем позицию для visibilitychange-восстановления
      savedScrollRef.current = {
        top: container.scrollTop,
        left: container.scrollLeft,
      };
      if (rafId != null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const w = container.clientWidth || 1;
        const next = Math.round(container.scrollLeft / w);
        setCurrentPage((prev) => (prev === next ? prev : next));
      });
    };
    container.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      window.clearTimeout(initialTimer);
      ro.disconnect();
      container.removeEventListener('scroll', onScroll);
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
    const container = contentRef.current;
    if (!container) return;
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        savedScrollRef.current = {
          top: container.scrollTop,
          left: container.scrollLeft,
        };
      } else {
        const { top, left } = savedScrollRef.current;
        if (top > 0 || left > 0) {
          requestAnimationFrame(() => {
            container.scrollTo({ top, left, behavior: 'instant' as ScrollBehavior });
          });
        }
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [ready, settings.readMode]);

  // ---- 6.6. Keyboard nav в pages-режиме ----
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
      const idx = Math.round(container.scrollLeft / w);
      const maxIdx = Math.max(0, Math.round(container.scrollWidth / w) - 1);
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        const t = Math.min(maxIdx, idx + 1);
        container.scrollTo({ left: t * w, behavior: 'smooth' });
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        const t = Math.max(0, idx - 1);
        container.scrollTo({ left: t * w, behavior: 'smooth' });
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

  // ---- 6.7. Smart tap/click navigation ----
  const flipBusyRef = useRef(false);
  const onContentClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (settings.readMode !== 'pages') return;
      const target = e.target as HTMLElement;
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
      const isEdgeTap = x < w * 0.33 || x > w * 0.67;
      if (isEdgeTap) {
        if (flipBusyRef.current) return;
        flipBusyRef.current = true;
        const idx = Math.round(container.scrollLeft / w);
        const dir = x < w * 0.33 ? -1 : 1;
        const maxIdx = Math.max(0, Math.round(container.scrollWidth / w) - 1);
        const targetIdx = Math.max(0, Math.min(maxIdx, idx + dir));
        container.scrollTo({ left: targetIdx * w, behavior: 'smooth' });
        setTimeout(() => { flipBusyRef.current = false; }, 320);
      } else {
        setUiHidden((v) => !v);
      }
    },
    [settings.readMode]
  );

  const scrollPageBy = useCallback(
    (direction: 1 | -1) => {
      const container = contentRef.current;
      if (!container) return;
      const w = container.clientWidth;
      if (!w) return;
      const idx = Math.round(container.scrollLeft / w);
      const maxIdx = Math.max(0, Math.round(container.scrollWidth / w) - 1);
      const t = Math.max(0, Math.min(maxIdx, idx + direction));
      container.scrollTo({ left: t * w, behavior: 'smooth' });
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
      const sl = container.scrollLeft;
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
    const sec = document.querySelector('.comments-section');
    if (!sec) return;
    if (settings.readMode === 'pages') {
      const container = contentRef.current;
      if (container) {
        container.scrollTo({ left: container.scrollWidth, behavior: 'instant' as ScrollBehavior });
      }
      setTimeout(() => sec.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    } else {
      sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [settings.readMode]);

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
      className={`reader-wrapper${settings.focusMode ? ' focus-mode' : ''}${uiHidden ? ' ui-hidden' : ''}`}
      data-theme={settings.theme ?? 'light'}
      data-read-mode={settings.readMode ?? 'scroll'}
    >
      {/* Старый верхний reader-toolbar убран — управление переехало в
          sticky-панель снизу (ReaderBottomBar), как в tene. Фокус-режим
          теперь только в Settings (плюс F-горячка ниже). */}

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

      <ReaderBottomBar
        readMode={settings.readMode === 'pages' ? 'pages' : 'scroll'}
        currentPage={currentPage}
        totalPages={totalPages}
        scrollPercent={scrollPercent}
        novelFirebaseId={novelFirebaseId ?? null}
        prevChapterNumber={prevChapterNumber}
        nextChapterNumber={nextChapterNumber}
        onSeekPage={(idx) => {
          const container = contentRef.current;
          if (!container) return;
          container.scrollTo({
            left: idx * (pageWidth || container.clientWidth),
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
        visible={!uiHidden}
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
