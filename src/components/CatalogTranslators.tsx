'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';

interface TranslatorRow {
  id: string;
  display_name: string;
  slug: string;
  avatar_url: string | null;
}

// Лёгкий поиск переводчиков прямо из /catalog. Подгружаем всех
// публичных переводчиков один раз (у Алёны их десятки, не тысячи) и
// фильтруем в JS. Клик — на /t/<slug>.
export default function CatalogTranslators() {
  const [all, setAll] = useState<TranslatorRow[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let abort = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('public_profiles')
        .select(
          'id, user_name, translator_slug, translator_display_name, translator_avatar_url, avatar_url, role, is_admin'
        );
      if (abort) return;
      const rows: TranslatorRow[] = [];
      for (const r of (data ?? []) as Array<Record<string, unknown>>) {
        const role = r.role as string | null;
        const isAdmin = r.is_admin === true;
        if (!(isAdmin || role === 'translator' || role === 'admin')) continue;
        const slug =
          (r.translator_slug as string | null) ??
          (r.user_name as string | null);
        if (!slug) continue;
        const name =
          (r.translator_display_name as string | null) ??
          (r.user_name as string | null) ??
          'Переводчик';
        rows.push({
          id: r.id as string,
          display_name: name,
          slug,
          avatar_url:
            (r.translator_avatar_url as string | null) ??
            (r.avatar_url as string | null) ??
            null,
        });
      }
      rows.sort((a, b) => a.display_name.localeCompare(b.display_name, 'ru'));
      setAll(rows);
    })();
    return () => {
      abort = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!all) return [];
    const q = query.trim().toLowerCase().replace(/ё/g, 'е');
    if (!q) return all;
    return all.filter(
      (t) =>
        t.display_name.toLowerCase().replace(/ё/g, 'е').includes(q) ||
        t.slug.toLowerCase().includes(q)
    );
  }, [all, query]);

  return (
    <div className="filter-group catalog-translators">
      <h4>Переводчики</h4>
      <input
        className="catalog-translators-input"
        type="search"
        placeholder="Имя или никнейм…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Поиск переводчиков"
      />
      {all === null ? (
        <p className="catalog-translators-empty">Загружаем…</p>
      ) : filtered.length === 0 ? (
        <p className="catalog-translators-empty">
          {query ? 'Никто не нашёлся.' : 'Переводчиков пока нет.'}
        </p>
      ) : (
        <ul className="catalog-translators-list">
          {filtered.slice(0, 30).map((t) => (
            <li key={t.id}>
              <Link
                href={`/t/${t.slug}`}
                className="catalog-translators-item"
              >
                <span className="catalog-translators-avatar">
                  {t.avatar_url ? (
                    <img src={t.avatar_url} alt="" />
                  ) : (
                    <span aria-hidden="true">🧑</span>
                  )}
                </span>
                <span className="catalog-translators-name">
                  {t.display_name}
                </span>
              </Link>
            </li>
          ))}
          {filtered.length > 30 && (
            <li className="catalog-translators-empty">
              …ещё {filtered.length - 30}. Уточни запрос.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
