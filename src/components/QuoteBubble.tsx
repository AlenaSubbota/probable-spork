'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

interface Props {
  novelId: number;
  chapterNumber: number;
  containerRef: React.RefObject<HTMLElement | null>;
  novelFirebaseId?: string;
  novelTitle?: string;
}

interface BubbleState {
  visible: boolean;
  top: number;
  left: number;
  text: string;
}

// Показывает всплывающую кнопку «Сохранить цитату» при выделении
// текста внутри containerRef. Сохраняет в public.user_quotes.
export default function QuoteBubble({
  novelId,
  chapterNumber,
  containerRef,
  novelFirebaseId,
  novelTitle,
}: Props) {
  const [state, setState] = useState<BubbleState>({
    visible: false, top: 0, left: 0, text: '',
  });
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied'>('idle');
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onSelection = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        setState((s) => ({ ...s, visible: false }));
        return;
      }
      const range = sel.getRangeAt(0);
      const text = sel.toString().trim();

      // Проверяем, что выделение внутри контейнера и не короче 3 символов
      if (text.length < 3 || text.length > 2000) {
        setState((s) => ({ ...s, visible: false }));
        return;
      }
      const commonAncestor = range.commonAncestorContainer;
      const node = commonAncestor.nodeType === 3 ? commonAncestor.parentNode : commonAncestor;
      if (!node || !container.contains(node as Node)) {
        setState((s) => ({ ...s, visible: false }));
        return;
      }

      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      setState({
        visible: true,
        top: rect.top + window.scrollY - 48,
        left: rect.left + window.scrollX + rect.width / 2,
        text,
      });
      setStatus('idle');
    };

    // Дебаунсим, чтобы не дёргалось
    const onMouseUp = () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = window.setTimeout(onSelection, 80);
    };

    const onScroll = () => setState((s) => ({ ...s, visible: false }));

    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('touchend', onMouseUp);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchend', onMouseUp);
      window.removeEventListener('scroll', onScroll);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, [containerRef]);

  const handleSave = async () => {
    setStatus('saving');
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setStatus('error');
      return;
    }
    const { error } = await supabase.from('user_quotes').insert({
      user_id: user.id,
      novel_id: novelId,
      chapter_number: chapterNumber,
      quote_text: state.text,
    });
    if (error) {
      setStatus('error');
    } else {
      setStatus('saved');
      window.setTimeout(() => {
        setState((s) => ({ ...s, visible: false }));
        window.getSelection()?.removeAllRanges();
      }, 900);
    }
  };

  // Поделиться: копируем текст цитаты + ссылку на главу в буфер.
  // Native Share API на мобильных выпадает в шторку, на десктопе — clipboard.
  const handleShare = async () => {
    if (!novelFirebaseId) return;
    const url =
      typeof window !== 'undefined'
        ? `${window.location.origin}/novel/${novelFirebaseId}/${chapterNumber}`
        : `/novel/${novelFirebaseId}/${chapterNumber}`;
    const shareText =
      `«${state.text}»\n\n` +
      (novelTitle ? `— из «${novelTitle}», глава ${chapterNumber}\n` : '') +
      url;

    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (nav && typeof nav.share === 'function') {
      try {
        await nav.share({
          title: novelTitle ? `Цитата из «${novelTitle}»` : 'Цитата',
          text: shareText,
        });
        setShareStatus('copied');
        window.setTimeout(() => setShareStatus('idle'), 1200);
        return;
      } catch {
        // пользователь закрыл шторку — валимся на clipboard
      }
    }
    try {
      await nav?.clipboard?.writeText(shareText);
      setShareStatus('copied');
      window.setTimeout(() => setShareStatus('idle'), 1200);
    } catch {
      // если clipboard запрещён — просто ничего не делаем
    }
  };

  if (!state.visible) return null;

  const label =
    status === 'saving' ? 'Сохраняем…' :
    status === 'saved'  ? '✓ В коллекции'  :
    status === 'error'  ? 'Ошибка'        :
    '⊹ Сохранить цитату';

  return (
    <div
      className="quote-bubble-wrap"
      style={{ top: `${state.top}px`, left: `${state.left}px` }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className={`quote-bubble${status === 'saved' ? ' saved' : ''}${
          status === 'error' ? ' error' : ''
        }`}
        onClick={handleSave}
      >
        {label}
      </button>
      {novelFirebaseId && (
        <button
          type="button"
          className={`quote-bubble quote-bubble--share${
            shareStatus === 'copied' ? ' saved' : ''
          }`}
          onClick={handleShare}
          title="Скопировать цитату со ссылкой"
        >
          {shareStatus === 'copied' ? '✓ Скопировано' : '↗ Поделиться'}
        </button>
      )}
    </div>
  );
}
