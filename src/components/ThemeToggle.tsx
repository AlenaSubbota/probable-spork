'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

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

// Серверная синхронизация темы — храним в profiles.settings.theme.
// Тот же jsonb-контейнер, что reader-настройки и adult_confirmed_at.
async function pushServerTheme(t: Theme) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('profiles')
      .select('settings')
      .eq('id', user.id)
      .maybeSingle();
    const all = (data?.settings ?? {}) as Record<string, unknown>;
    const merged = { ...all, theme: t };
    await supabase.rpc('update_my_profile', {
      data_to_update: { settings: merged },
    });
  } catch { /* ignore */ }
}

async function fetchServerTheme(): Promise<Theme | null> {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
      .from('profiles')
      .select('settings')
      .eq('id', user.id)
      .maybeSingle();
    const all = (data?.settings ?? {}) as Record<string, unknown>;
    const t = all.theme;
    if (t === 'light' || t === 'dark' || t === 'auto') return t;
    return null;
  } catch { return null; }
}

// Переключатель темы (light / dark / auto). Мини-панель из трёх чипов.
// Состояние сохраняется в localStorage + profiles.settings.theme на
// сервере (для синка между устройствами). При 'auto' слушает
// prefers-color-scheme и перерисовывает автоматически.
//
// При монтировании читает localStorage и применяет тему (на случай если
// инлайн-скрипт в <head> не отработал), затем подтягивает серверную
// тему и перебивает локальную если она отличается.
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('auto');

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? 'auto';
    setTheme(stored);
    apply(stored);
    let cancelled = false;
    (async () => {
      const fromServer = await fetchServerTheme();
      if (cancelled || !fromServer) return;
      if (fromServer !== stored) {
        setTheme(fromServer);
        localStorage.setItem(STORAGE_KEY, fromServer);
        apply(fromServer);
      }
    })();
    return () => { cancelled = true; };
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
    pushServerTheme(next);
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
