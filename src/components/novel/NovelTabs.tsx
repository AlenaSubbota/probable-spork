'use client';

import { useEffect, useRef, useState } from 'react';
import './novel-tabs.css';

interface Tab {
  id: string;
  label: string;
}

interface Props {
  tabs: Tab[];
}

// Sticky-бар табов на странице новеллы. Не управляет видимостью контента
// (всё рендерится сразу — лучше для SEO, проще для server-component'ов),
// а только смолл-скроллит к якорям и подсвечивает таб, чей раздел сейчас
// в центре viewport'а.
//
// Логика:
//   1. Клик по табу → window.scrollTo(targetTop) + history.replaceState
//      (чтобы URL содержал #id и можно было поделиться).
//   2. IntersectionObserver на каждой секции — выбирает «самую
//      видимую» как активную. Threshold 0 + rootMargin '-40% 0px -40% 0px'
//      означает: секция считается активной, когда её центр пересёк
//      центральные 20% экрана.
export default function NovelTabs({ tabs }: Props) {
  const [activeId, setActiveId] = useState<string>(tabs[0]?.id ?? '');
  const navRef = useRef<HTMLDivElement | null>(null);

  // Подписка на видимость секций.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const elements = tabs
      .map((t) => document.getElementById(t.id))
      .filter((el): el is HTMLElement => !!el);

    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Берём ту секцию, у которой intersectionRatio самый большой
        // среди тех, что сейчас «active». Иначе листание между секциями
        // может помечать активной секцию, в которую только-только
        // начали скроллить.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        // Зона активности — центральные 20% экрана. При маленьких
        // секциях это даёт стабильную подсветку: «отзывы» подсветятся
        // только когда читатель реально докрутил до них.
        rootMargin: '-40% 0px -40% 0px',
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [tabs]);

  // Если URL пришёл с #id — после монтирования прокручиваем туда сами,
  // потому что наш sticky-bar перекрывает таргет.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.replace('#', '');
    if (!hash) return;
    const target = document.getElementById(hash);
    if (target) {
      // микро-задержка — даём React дорисовать
      requestAnimationFrame(() => scrollToWithOffset(target));
    }
  }, []);

  const handleClick = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const target = document.getElementById(id);
    if (target) {
      scrollToWithOffset(target);
      // Меняем hash в URL без re-render и без пересоздания истории каждый клик
      history.replaceState(null, '', `#${id}`);
      setActiveId(id);
    }
  };

  return (
    <div className="novel-tabs-wrap">
      <nav
        className="novel-tabs"
        ref={navRef}
        aria-label="Разделы страницы"
      >
        {tabs.map((t) => (
          <a
            key={t.id}
            href={`#${t.id}`}
            className={`novel-tab${activeId === t.id ? ' is-active' : ''}`}
            onClick={handleClick(t.id)}
          >
            {t.label}
          </a>
        ))}
      </nav>
    </div>
  );
}

// scrollIntoView({block:'start'}) скроллит так, что target стоит ровно у
// верхнего края — наш sticky-bar его прикрывает. Считаем offset до
// нижнего края бара и компенсируем.
function scrollToWithOffset(target: HTMLElement) {
  const bar = document.querySelector('.novel-tabs-wrap') as HTMLElement | null;
  const barH = bar?.getBoundingClientRect().height ?? 56;
  const y = target.getBoundingClientRect().top + window.scrollY - barH - 12;
  window.scrollTo({ top: y, behavior: 'smooth' });
}
