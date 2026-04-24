'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

type Theme = 'light' | 'dark' | 'auto';

const STORAGE_KEY = 'chaptify-theme';
const VALID: Theme[] = ['light', 'dark', 'auto'];

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
// Состояние сохраняется в localStorage + profiles.settings.theme (мигр. 047,
// RPC update_my_settings_patch). Синхронизация между устройствами: когда
// юзер выбрал «Тёмная» на телефоне, на десктопе тема автоматически
// применится при следующем заходе.
//
// При монтировании:
//   1. Читаем localStorage и применяем немедленно — избегаем flash-of-light.
//   2. Асинхронно спрашиваем сервер; если на сервере другая тема — применяем.
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('auto');

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? 'auto';
    setTheme(stored);
    apply(stored);

    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        const { data } = await supabase
          .from('profiles')
          .select('settings')
          .eq('id', user.id)
          .maybeSingle();
        if (cancelled) return;
        const serverTheme = (data?.settings as { theme?: string } | null)?.theme;
        if (
          serverTheme &&
          VALID.includes(serverTheme as Theme) &&
          serverTheme !== stored
        ) {
          const t = serverTheme as Theme;
          setTheme(t);
          localStorage.setItem(STORAGE_KEY, t);
          apply(t);
        }
      } catch {
        // ignore — RPC/таблицы ещё не готовы
      }
    })();
    return () => {
      cancelled = true;
    };
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
    // Debounce не нужен: клики по переключателю редки. Можем сразу
    // писать на сервер. При ошибке (мигр. 047 не накачена / юзер не
    // залогинен) — тихо падаем, localStorage продолжает работать.
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        await supabase.rpc('update_my_settings_patch', { patch: { theme: next } });
      } catch {
        // ignore
      }
    })();
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
