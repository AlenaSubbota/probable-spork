'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
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
  // --- STATE: НАСТРОЙКИ И ДАННЫЕ ---
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [uiHidden, setUiHidden] = useState(false);
  const [commentCount, setCommentCount] = useState<number | null>(null);

  // --- STATE: ТАЙМЕР СНА ---
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [sleepMinLeft, setSleepMinLeft] = useState<number | null>(null);
  const [sleepExpired, setSleepExpired] = useState(false);
  const [sleepDismissed, setSleepDismissed] = useState(false);

  // --- STATE: ЧИТАЛКА И СКРОЛЛ ---
  const [pageWidth, setPageWidth] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [scrollProgress, setScrollProgress] = useState(0);

  // --- REFS ---
  const contentRef = useRef<HTMLDivElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const savedScrollRef = useRef({ top: 0, left: 0 });
  const flipBusyRef = useRef(false);
  const settingsPushTimer = useRef<number | null>(null);

  // --- 1. ЗАГРУЗКА НАСТРОЕК ---
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
      } catch { /* network error -> local settings */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const updateSettings = useCallback((next: ReaderSettings) => {
    setSettings(next);
    saveSettings(next);
    if (settingsPushTimer.current != null) window.clearTimeout(settingsPushTimer.current);
    settingsPushTimer.current = window.setTimeout(() => {
      const supabase = createClient();
      pushServerSettings(supabase, next).catch(() => {});
    }, 600);
  }, []);

  // --- 2. ГОРЯЧИЕ КЛАВИШИ ---
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '+' || e.key === '=') {
        updateSettings({ ...settings, fontSize: Math.min(26, settings.fontSize + 1) });
      } else if (e.key === '-' || e.key === '_') {
        updateSettings({ ...settings, fontSize: Math.max(13, settings.fontSize - 1) });
      } else if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') {
        if (settings.readMode !== 'pages') {
          updateSettings({ ...settings, focusMode: !settings.focusMode });
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [settings, updateSettings]);

  // --- 3. СОХРАНЕНИЕ ПРОГРЕССА ---
  const saveProgress = useCallback(async (paragraphIndex: number) => {
    try {
      localStorage.setItem(`progress_${novelId}`, JSON.stringify({
        chapterId: chapterNumber, paragraphIndex, timestamp: new Date().toISOString(),
      }));
    } catch {}

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase.from('profiles').select('last_read').eq('id', user.id).maybeSingle();
    const prev = (profile?.last_read || {}) as Record<string, any>;
    const updated = {
      ...prev,
      [String(novelId)]: { novelId, chapterId: chapterNumber, paragraphIndex, timestamp: new Date().toISOString() },
    };

    await supabase.rpc('update_my_profile', { data_to_update: { last_read: updated } });
    supabase.rpc('log_reading_day').then(() => {}, () => {});
  }, [novelId, chapterNumber]);

  // --- 4. СПАСЕНИЕ СКРОЛЛА ПРИ БЛОКИРОВКЕ (iOS/Android баг) ---
  useEffect(() => {
    const handleVisibility = () => {
      const container = contentRef.current;
      if (!container) return;
      if (document.visibilityState === 'hidden') {
        savedScrollRef.current = { top: container.scrollTop, left: container.scrollLeft };
      } else if (document.visibilityState === 'visible') {
        const { top, left } = savedScrollRef.current;
        if (top > 0 || left > 0) {
          requestAnimationFrame(() => container.scrollTo({ top, left, behavior: 'instant' as ScrollBehavior }));
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // --- 5. ОБРАБОТЧИК СКРОЛЛА И АКТИВНЫХ АБЗАЦЕВ ---
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    savedScrollRef.current = { top: container.scrollTop, left: container.scrollLeft };

    if (settings.readMode !== 'pages') {
      const maxScroll = container.scrollHeight - container.clientHeight;
      setScrollProgress(maxScroll > 0 ? (container.scrollTop / maxScroll) * 100 : 0);
    } else {
      const w = container.clientWidth || 1;
      const next = Math.round(container.scrollLeft / w);
      setCurrentPage((prev) => (prev === next ? prev : next));
    }

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      const paragraphs = container.querySelectorAll<HTMLElement>('p, h1, h2, h3, blockquote');
      if (paragraphs.length === 0) return;

      let bestIdx = 0;
      if (settings.readMode === 'pages') {
        const sl = container.scrollLeft;
        const pageW = container.clientWidth || 1;
        for (let i = 0; i < paragraphs.length; i++) {
          if (paragraphs[i].offsetLeft + paragraphs[i].offsetWidth >= sl + 1) {
            bestIdx = i;
            if (paragraphs[i].offsetLeft >= sl) break;
          }
          if (paragraphs[i].offsetLeft > sl + pageW) break;
        }
      } else {
        const containerRect = container.getBoundingClientRect();
        const viewportMid = containerRect.top + containerRect.height / 2;
        let bestDist = Infinity;
        paragraphs.forEach((el, i) => {
          const r = el.getBoundingClientRect();
          const elMid = r.top + r.height / 2;
          const dist = Math.abs(elMid - viewportMid);
          if (dist < bestDist) { bestDist = dist; bestIdx = i; }
        });
      }

      paragraphs.forEach((el, i) => {
        if (i === bestIdx) el.classList.add('focus-active');
        else el.classList.remove('focus-active');
      });

      saveProgress(bestIdx);
    }, 1500);
  }, [settings.readMode, saveProgress]);

  // --- 6. SMART TAP (Зоны экрана: 30% - 40% - 30%) ---
  const onContentClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) return;

    const target = e.target as Element;
    if (target && typeof target.closest === 'function' && target.closest('a, button, input, textarea, select, [contenteditable="true"], .glossary-term, .quote-bubble')) return;

    const container = contentRef.current;
    if (!container) return;

    if (settings.readMode !== 'pages') {
      setUiHidden(v => !v);
      return;
    }

    const w = container.clientWidth;
    if (!w) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;

    if (x < w * 0.3) {
      if (flipBusyRef.current) return;
      const idx = Math.round(container.scrollLeft / w);
      if (idx > 0) {
        flipBusyRef.current = true;
        container.scrollTo({ left: (idx - 1) * w, behavior: 'smooth' });
        setTimeout(() => { flipBusyRef.current = false; }, 320);
      }
    } else if (x > w * 0.7) {
      if (flipBusyRef.current) return;
      const maxIdx = Math.max(0, Math.round(container.scrollWidth / w) - 1);
      const idx = Math.round(container.scrollLeft / w);
      if (idx < maxIdx) {
        flipBusyRef.current = true;
        container.scrollTo({ left: (idx + 1) * w, behavior: 'smooth' });
        setTimeout(() => { flipBusyRef.current = false; }, 320);
      }
    } else {
      setUiHidden(v => !v);
    }
  }, [settings.readMode]);

  // --- 7. ВОССТАНОВЛЕНИЕ ПОЗИЦИИ ---
  useEffect(() => {
    if (!ready) return;
    const container = contentRef.current;
    if (!container) return;

    let cancelled = false;
    const restoreTo = (data: any) => {
      if (data.chapterId !== chapterNumber) return;
      const idx = data.paragraphIndex ?? 0;
      const paragraphs = container.querySelectorAll<HTMLElement>('p, h1, h2, h3, blockquote');
      const target = paragraphs[idx];
      if (!target) return;

      if (settings.readMode === 'pages') {
        const pageW = container.clientWidth;
        if (pageW > 0) {
          const pageIdx = Math.floor(target.offsetLeft / pageW);
          container.scrollTo({ left: pageIdx * pageW, behavior: 'instant' as ScrollBehavior });
        }
      } else {
        const targetRect = target.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const top = targetRect.top - containerRect.top + container.scrollTop - window.innerHeight / 3;
        container.scrollTo({ top: Math.max(0, top), behavior: 'instant' as ScrollBehavior });
      }
    };

    const params = new URLSearchParams(window.location.search);
    if (params.get('end') === '1') {
      setTimeout(() => {
        if (settings.readMode === 'pages') container.scrollTo({ left: container.scrollWidth, behavior: 'instant' as ScrollBehavior });
        else container.scrollTo({ top: container.scrollHeight, behavior: 'instant' as ScrollBehavior });
      }, 160);
      return;
    }

    try {
      const raw = localStorage.getItem(`progress_${novelId}`);
      if (raw) setTimeout(() => { if (!cancelled) restoreTo(JSON.parse(raw)); }, 160);
    } catch {}

    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from('profiles').select('last_read').eq('id', user.id).maybeSingle();
      if (cancelled || !profile?.last_read) return;
      
      const serverData = (profile.last_read as any)[String(novelId)];
      if (serverData) {
        localStorage.setItem(`progress_${novelId}`, JSON.stringify(serverData));
        setTimeout(() => { if (!cancelled) restoreTo(serverData); }, 220);
      }
    })();
    return () => { cancelled = true; };
  }, [ready, content, novelId, chapterNumber, settings.readMode]);

  // --- 8. КАЛЬКУЛЯЦИЯ СТРАНИЦ ДЛЯ PAGES MODE ---
  useEffect(() => {
    if (!ready || settings.readMode !== 'pages') {
      setPageWidth(0); setCurrentPage(0); setTotalPages(1);
      return;
    }
    const container = contentRef.current;
    if (!container) return;

    const calc = () => {
      const w = container.clientWidth;
      if (!w) return;
      setPageWidth(w);
      requestAnimationFrame(() => {
        const total = Math.max(1, Math.round(container.scrollWidth / w));
        setTotalPages(total);
      });
    };

    if ('fonts' in document) {
      const docFonts = (document as any).fonts;
      if (docFonts && docFonts.ready) {
        docFonts.ready.then(calc).catch(calc);
      } else {
        calc();
      }
    } else {
      calc();
    }

    let lastWidth = container.clientWidth;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.round(e.contentRect.width);
        if (Math.abs(w - lastWidth) > 0.5) { lastWidth = w; calc(); }
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [ready, content, settings.readMode, settings.fontSize, settings.lineHeight, settings.fontFamily]);

  // --- 9. ГЛОССАРИЙ (INLINE ТЕРМИНЫ) ---
  const [glossaryPopover, setGlossaryPopover] = useState<null | { x: number; y: number; item: GlossaryItem }>(null);
  useEffect(() => {
    if (!ready || glossary.length === 0) return;
    const container = contentRef.current;
    if (!container) return;

    const sortedTerms = [...glossary].sort((a, b) => b.term_original.length - a.term_original.length);
    const lookup = new Map<string, GlossaryItem>();
    for (const g of sortedTerms) lookup.set(g.term_original.toLowerCase(), g);

    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = sortedTerms.map((g) => escape(g.term_original)).join('|');
    if (!pattern) return;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(${pattern})(?![\\p{L}\\p{N}])`, 'giu');

    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest('code, pre, script, style, .glossary-term')) return NodeFilter.FILTER_REJECT;
        const nodeValue = node.nodeValue || '';
        if (!nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let tn; while ((tn = walker.nextNode())) textNodes.push(tn as Text);

    const wrapped: HTMLElement[] = [];
    for (const node of textNodes) {
      const text = node.nodeValue ?? '';
      if (!re.test(text)) continue;
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0; let match;
      while ((match = re.exec(text)) !== null) {
        if (match.index > last) frag.appendChild(document.createTextNode(text.slice(last, match.index)));
        const term = match[0]; const item = lookup.get(term.toLowerCase());
        if (item) {
          const span = document.createElement('span');
          span.className = 'glossary-term bg-blue-500/20 text-blue-600 border-b border-blue-500/50 cursor-pointer rounded px-1';
          span.dataset.term = item.term_original;
          span.textContent = term;
          frag.appendChild(span); wrapped.push(span);
        } else {
          frag.appendChild(document.createTextNode(term));
        }
        last = match.index + term.length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode?.replaceChild(frag, node);
    }

    const onSpanClick = (e: Event) => {
      const target = e.currentTarget as HTMLElement;
      const item = glossary.find((g) => g.term_original === target.dataset.term);
      if (!item) return;
      const rect = target.getBoundingClientRect();
      setGlossaryPopover({ x: rect.left + rect.width / 2, y: rect.bottom + 6, item });
      e.stopPropagation();
    };
    wrapped.forEach(span => span.addEventListener('click', onSpanClick));
    
    const onDocClick = () => setGlossaryPopover(null);
    document.addEventListener('click', onDocClick);
    return () => {
      wrapped.forEach(span => span.removeEventListener('click', onSpanClick));
      document.removeEventListener('click', onDocClick);
    };
  }, [ready, content, glossary]);

  // --- ЗАГРУЗКА КОММЕНТАРИЕВ ДЛЯ СЧЕТЧИКА ---
  useEffect(() => {
    (async () => {
      const { count } = await createClient().from('comments').select('id', { count: 'exact', head: true })
        .eq('novel_id', novelId).eq('chapter_number', chapterNumber).is('deleted_at', null);
      if (typeof count === 'number') setCommentCount(count);
    })();
  }, [novelId, chapterNumber]);

  // --- ТАЙМЕР СНА ---
  useEffect(() => {
    if (selectedPreset === null) { setSleepMinLeft(null); setSleepExpired(false); return; }
    const expireAt = Date.now() + selectedPreset * 60 * 1000;
    setSleepMinLeft(selectedPreset); setSleepExpired(false);
    const id = window.setInterval(() => {
      const leftMs = expireAt - Date.now();
      if (leftMs <= 0) { setSleepMinLeft(0); setSleepExpired(true); } 
      else setSleepMinLeft(Math.ceil(leftMs / 60_000));
    }, 30_000);
    return () => window.clearInterval(id);
  }, [selectedPreset]);

  // СТИЛИ ТЕКСТА
  const bodyStyle: React.CSSProperties = {
    fontSize: `${settings.fontSize}px`,
    lineHeight: settings.lineHeight,
    fontFamily: getFontCss(settings.fontFamily),
    textAlign: (settings.textAlign || 'left') as React.CSSProperties['textAlign'],
    color: 'var(--ink)',
    ...(settings.readMode === 'pages' ? {
      width: `${pageWidth}px`,
      columnWidth: `${Math.max(1, pageWidth - 48)}px`,
      columnGap: '48px',
      padding: '24px 24px 32px 24px',
      boxSizing: 'border-box',
      columnFill: 'auto',
      hyphens: 'auto'
    } : {
      padding: '40px 24px 80px 24px',
      maxWidth: '800px',
      margin: '0 auto',
      hyphens: 'auto'
    })
  };

  const scrollPageBy = (dir: 1 | -1) => {
    const container = contentRef.current;
    if (!container) return;
    const w = container.clientWidth;
    if (!w) return;
    const t = Math.max(0, Math.min(totalPages - 1, currentPage + dir));
    container.scrollTo({ left: t * w, behavior: 'smooth' });
  };

  if (!ready) return <div className="min-h-screen bg-background" />;

  return (
    <div className="fixed inset-0 bg-background flex justify-center overflow-hidden select-none" data-theme={settings.theme ?? 'light'}>
      <div className={`w-full max-w-4xl h-full relative flex flex-col shadow-2xl bg-[var(--bg)] text-[var(--ink)] reader-wrapper${settings.focusMode ? ' focus-mode' : ''}`}>
        
        {/* --- ВЕРХНЯЯ ПАНЕЛЬ (HEADER) --- */}
        <div className={`absolute top-0 left-0 right-0 z-40 bg-[var(--bg)] border-b border-[var(--border)] shadow-sm transition-transform duration-300 flex justify-between p-3 ${uiHidden ? '-translate-y-full' : 'translate-y-0'}`}>
           <div className="flex gap-2">
             {novelFirebaseId && (
               <button onClick={() => setTocOpen(true)} className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--bg-soft)] transition-colors">
                 ≡ Оглавление
               </button>
             )}
             {settings.readMode !== 'pages' && (
               <button onClick={() => updateSettings({ ...settings, focusMode: !settings.focusMode })} className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${settings.focusMode ? 'bg-[var(--accent)] text-white border-[var(--accent)]' : 'border-[var(--border)] hover:bg-[var(--bg-soft)]'}`}>
                 ◉ Фокус
               </button>
             )}
           </div>
           <button onClick={() => setSettingsOpen(true)} className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-sm font-medium hover:bg-[var(--bg-soft)] transition-colors">
             ⚙ Настройки
           </button>
        </div>

        {/* --- ОБЛАСТЬ ЧТЕНИЯ --- */}
        <div
          ref={contentRef}
          onScroll={handleScroll}
          onClick={onContentClick}
          className={`flex-1 w-full h-[100vh] transition-opacity duration-500 ${
            settings.readMode === 'pages' ? 'overflow-x-auto overflow-y-hidden flex snap-x snap-mandatory' : 'overflow-y-auto overflow-x-hidden pb-20'
          }`}
        >
          {/* ТЕКСТ ГЛАВЫ */}
          <div 
            className={`chapter-content novel-content ${settings.readMode === 'pages' ? 'shrink-0 snap-start' : 'w-full'}`}
            style={bodyStyle}
            dangerouslySetInnerHTML={{ __html: content }}
          />

          {/* SPACERS (Только для постраничного режима) */}
          {settings.readMode === 'pages' && Array.from({ length: Math.max(0, totalPages - 1) }).map((_, i) => (
            <div key={`snap-${i}`} className="shrink-0 h-[100vh] snap-start pointer-events-none" style={{ width: `${pageWidth}px` }} />
          ))}

          {/* КОНЕЦ ГЛАВЫ И КОММЕНТАРИИ */}
          <div 
            className={`comments-section flex flex-col items-center justify-center bg-[var(--bg-soft)] ${settings.readMode === 'pages' ? 'shrink-0 snap-start h-[100vh] w-full px-4 overflow-y-auto' : 'w-full py-20 px-4 mt-12 border-t border-[var(--border)]'}`} 
            style={settings.readMode === 'pages' ? { width: `${pageWidth}px` } : {}}
            onClick={(e) => { e.stopPropagation(); setUiHidden(prev => !prev); }}
          >
             <h2 className="text-3xl font-bold mb-4 font-sans text-center">Глава прочитана 🎉</h2>
             <p className="opacity-70 mb-8 text-center text-sm">Здесь заканчивается глава. Что думаете о ней?</p>
             <button
                onClick={(e) => {
                  e.stopPropagation();
                  alert("Тут можно открыть компонент комментариев!");
                }}
                className="bg-[var(--accent)] text-white font-bold text-lg py-4 px-10 rounded-2xl shadow-lg hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
             >
                💬 Комментарии ({commentCount ?? 0})
             </button>
          </div>
        </div>

        {/* --- НИЖНИЯЯ ПАНЕЛЬ С ПРОГРЕСС-БАРОМ --- */}
        <div className={`absolute bottom-0 left-0 right-0 z-40 bg-[var(--bg)] border-t border-[var(--border)] flex flex-col transition-transform duration-300 shadow-[0_-10px_30px_rgba(0,0,0,0.05)] ${uiHidden ? 'translate-y-full' : 'translate-y-0'}`}>
          <div className="w-full px-4 pt-4 pb-2 flex flex-col gap-2">
            <div className="flex justify-between items-center text-xs opacity-70 font-mono tracking-widest px-1">
                {settings.readMode === 'scroll' ? (
                    <><span>Прогресс</span><span>{Math.round(scrollProgress)}%</span></>
                ) : (
                    <><span>Стр. {currentPage + 1}</span><span>из {totalPages}</span></>
                )}
            </div>
            <div className="w-full h-2.5 bg-[var(--bg-soft)] rounded-full relative cursor-pointer flex items-center overflow-hidden border border-[var(--border)]">
                <input 
                    type="range"
                    min={0}
                    max={settings.readMode === 'scroll' ? 100 : Math.max(0, totalPages - 1)}
                    value={settings.readMode === 'scroll' ? scrollProgress : currentPage}
                    onChange={(e) => {
                        const val = Number(e.target.value);
                        const container = contentRef.current;
                        if (!container) return;
                        if (settings.readMode === 'scroll') {
                            const maxScroll = container.scrollHeight - container.clientHeight;
                            container.scrollTo({ top: (val / 100) * maxScroll, behavior: 'auto' });
                        } else {
                            container.scrollTo({ left: val * pageWidth, behavior: 'auto' });
                        }
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div 
                    className="bg-[var(--accent)] h-full transition-all duration-150" 
                    style={{ width: `${settings.readMode === 'scroll' ? scrollProgress : (totalPages > 1 ? (currentPage / (totalPages - 1)) * 100 : 100)}%` }}
                />
            </div>
          </div>

          <div className="p-2 flex justify-between items-center">
             <button
                onClick={() => scrollPageBy(-1)}
                disabled={settings.readMode === 'pages' && currentPage === 0}
                className="p-4 text-3xl leading-none disabled:opacity-30 active:scale-95 transition-transform font-light"
             >‹</button>
             
             <div className="flex gap-3">
               <button onClick={() => {
                  const container = contentRef.current;
                  if (!container) return;
                  if (settings.readMode === 'pages') {
                    container.scrollTo({ left: container.scrollWidth, behavior: 'smooth' });
                  } else {
                    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
                  }
               }} className="px-5 py-2.5 rounded-xl border border-[var(--border)] text-sm font-medium hover:bg-[var(--bg-soft)] transition-colors flex items-center gap-2">
                 💬 <span className="opacity-70">{commentCount ?? 0}</span>
               </button>
             </div>

             <button
                onClick={() => scrollPageBy(1)}
                disabled={settings.readMode === 'pages' && currentPage >= totalPages - 1}
                className="p-4 text-3xl leading-none disabled:opacity-30 active:scale-95 transition-transform font-light"
             >›</button>
          </div>
        </div>

        {/* --- ПОПАП ГЛОССАРИЯ --- */}
        {glossaryPopover && (
          <div className="fixed z-50 bg-[var(--bg)] border border-[var(--border)] shadow-xl rounded-lg p-3 max-w-[250px]" style={{ left: glossaryPopover.x, top: glossaryPopover.y, transform: 'translate(-50%, 0)' }} onClick={(e) => e.stopPropagation()}>
            <div className="font-bold text-sm mb-1">{glossaryPopover.item.term_original}</div>
            <div className="text-sm opacity-90">{glossaryPopover.item.term_translation}</div>
            {glossaryPopover.item.category && <div className="text-[10px] uppercase tracking-wider opacity-50 mt-2">{labelForCategory(glossaryPopover.item.category)}</div>}
          </div>
        )}

        {/* --- МОДАЛКИ (Next.js Компоненты) --- */}
        <QuoteBubble novelId={novelId} chapterNumber={chapterNumber} containerRef={contentRef} novelFirebaseId={novelFirebaseId} novelTitle={novelTitle} />
        <ReaderSettingsPanel open={settingsOpen} settings={settings} onChange={updateSettings} onClose={() => setSettingsOpen(false)} selectedPreset={selectedPreset} sleepMinLeft={sleepMinLeft} onSleepTimerSet={(m) => { setSelectedPreset(m); setSleepDismissed(false); }} />
        {sleepExpired && !sleepDismissed && <SleepTimerOverlay onExtend={(ext) => { setSelectedPreset(ext); setSleepDismissed(true); }} onDismiss={() => { setSleepDismissed(true); setSelectedPreset(null); }} />}
        {novelFirebaseId && <ChapterTOC open={tocOpen} onClose={() => setTocOpen(false)} novelId={novelId} novelFirebaseId={novelFirebaseId} novelTitle={novelTitle ?? null} currentChapter={chapterNumber} />}
      </div>

      <style jsx global>{`
        .novel-content p, .novel-content blockquote {
          margin-top: ${settings.paragraphSpacing ?? 0.8}em;
          margin-bottom: ${settings.paragraphSpacing ?? 0.8}em;
          text-indent: ${settings.textIndent ?? 1.5}em;
        }
        .novel-content h1, .novel-content h2, .novel-content h3 { text-indent: 0; margin-top: 2em; margin-bottom: 1em; }
        .novel-content i, .novel-content em { font-style: italic; }
        .novel-content blockquote { border-left: 3px solid var(--accent); padding-left: 1em; color: var(--ink); font-style: italic; opacity: 0.8; }
        .focus-mode .novel-content p { transition: opacity 0.3s ease; opacity: 0.4; }
        .focus-mode .novel-content p.focus-active { opacity: 1; text-shadow: 0 0 1px rgba(0,0,0,0.1); }
      `}</style>
    </div>
  );
}
