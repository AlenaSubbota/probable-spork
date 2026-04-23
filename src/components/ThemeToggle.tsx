'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'auto';

const STORAGE_KEY = 'chaptify-theme';

function apply(theme: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const resolved =
    theme === 'auto'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
  root.setAttribute('data-theme', resolved);
}

// Переключатель темы (light / dark / auto). Мини-панель из трёх чипов.
// Состояние сохраняется в localStorage. При 'auto' слушает
// prefers-color-scheme и перерисовывает автоматически.
//
// При монтировании читает localStorage и применяет тему (на случай если
// инлайн-скрипт в <head> не отработал).
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('auto');

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? 'auto';
    setTheme(stored);
    apply(stored);
  }, []);

  useEffect(() => {
    if (theme !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('auto');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const update = (next: Theme) => {
    setTheme(next);
    localStorage.setItem(STORAGE_KEY, next);
    apply(next);
  };

  const opts: Array<{ key: Theme; label: string; icon: string }> = [
    { key: 'light', label: 'Светлая', icon: '☀' },
    { key: 'dark', label: 'Тёмная', icon: '☾' },
    { key: 'auto', label: 'Авто', icon: '◐' },
  ];

  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Тема оформления">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          className={`theme-toggle-btn${theme === o.key ? ' is-active' : ''}`}
          onClick={() => update(o.key)}
          role="radio"
          aria-checked={theme === o.key}
          title={o.label}
        >
          <span aria-hidden="true">{o.icon}</span>
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}
