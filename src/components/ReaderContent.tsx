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

interface Props {
  content: string;
  novelId: number;
  chapterNumber: number;
}

export default function ReaderContent({ content, novelId, chapterNumber }: Props) {
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Таймер сна: null — выключен, 0 — истёк (показываем overlay), >0 — осталось мин.
  const [sleepMin, setSleepMin] = useState<number | null>(null);
  const [sleepDismissed, setSleepDismissed] = useState(false);
  const sleepStartedRef = useRef<number | null>(null);

  // Фокус-режим: индекс активного абзаца
  const [activeParagraph, setActiveParagraph] = useState<number>(-1);

  const contentRef = useRef<HTMLDivElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);

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

      // Читаем текущий last_read, мерджим, обновляем
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
      await supabase
        .from('profiles')
        .update({ last_read: updated })
        .eq('id', user.id);
    },
    [novelId, chapterNumber]
  );

  // ---- 5. Отслеживание активного абзаца (scroll -> focus mode + прогресс) ----
  useEffect(() => {
    if (!ready) return;
    const container = contentRef.current;
    if (!container) return;

    const paragraphs = container.querySelectorAll<HTMLElement>('p, h1, h2, h3, blockquote');
    if (paragraphs.length === 0) return;

    const onScroll = () => {
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
      setActiveParagraph(bestIdx);

      // Дебаунсенное сохранение прогресса
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => saveProgress(bestIdx), 1500);
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [ready, content, saveProgress]);

  // ---- 6. Восстановление позиции из last_read при заходе ----
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
      if (target) {
        // Небольшая задержка, чтобы шрифты успели подгрузиться
        setTimeout(() => {
          target.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
        }, 120);
      }
    } catch { /* ignore */ }
  }, [ready, content, novelId, chapterNumber]);

  // ---- 7. Таймер сна (обратный отсчёт) ----
  useEffect(() => {
    if (sleepMin === null || sleepMin <= 0) return;
    sleepStartedRef.current = Date.now();
    const totalMs = sleepMin * 60 * 1000;
    const expireAt = sleepStartedRef.current + totalMs;

    const tick = () => {
      const leftMs = expireAt - Date.now();
      if (leftMs <= 0) {
        setSleepMin(0);
        setSleepDismissed(false);
      } else {
        setSleepMin(Math.ceil(leftMs / 60_000));
      }
    };
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [sleepMin]);

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
    <div className={`reader-wrapper${settings.focusMode ? ' focus-mode' : ''}`}>
      <div className="reader-toolbar">
        <button
          type="button"
          className={`chip${settings.focusMode ? ' active' : ''}`}
          onClick={() => updateSettings({ ...settings, focusMode: !settings.focusMode })}
          title="F"
        >
          ◉ Фокус
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

      <div
        ref={contentRef}
        className="novel-content"
        style={bodyStyle}
        data-active-paragraph={activeParagraph}
        data-text-indent={settings.textIndent}
        data-paragraph-spacing={settings.paragraphSpacing}
        dangerouslySetInnerHTML={{ __html: content }}
      />

      <QuoteBubble novelId={novelId} chapterNumber={chapterNumber} containerRef={contentRef} />

      <ReaderSettingsPanel
        open={settingsOpen}
        settings={settings}
        onChange={updateSettings}
        onClose={() => setSettingsOpen(false)}
        sleepTimerMin={sleepMin}
        onSleepTimerSet={(m) => {
          setSleepMin(m);
          setSleepDismissed(false);
        }}
      />

      {sleepMin === 0 && !sleepDismissed && (
        <SleepTimerOverlay
          onExtend={(extra) => {
            setSleepMin(extra);
            setSleepDismissed(true);
          }}
          onDismiss={() => {
            setSleepDismissed(true);
            setSleepMin(null);
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

        /* Фокус-режим: затемняем всё, кроме активного абзаца */
        .reader-wrapper.focus-mode .novel-content > * {
          transition: opacity .25s, filter .25s;
          opacity: 0.28;
        }
        .reader-wrapper.focus-mode .novel-content > *:nth-child(${activeParagraph + 1}) {
          opacity: 1;
        }
      `}</style>
    </div>
  );
}
