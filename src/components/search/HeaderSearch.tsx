'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { getCoverUrl } from '@/lib/format';

interface NovelHit {
  id: number;
  firebase_id: string;
  title: string;
  author: string | null;
  cover_url: string | null;
}

interface TranslatorHit {
  id: string;
  name: string;
  slug: string | null;
  avatar_url: string | null;
}

// Хедерный поиск с выпадающими подсказками. На submit (Enter / клик на
// «все результаты») уходим на /search?q=…, а в dropdown — топ-5 новелл +
// топ-3 переводчика в реальном времени (250 мс debounce).
//
// Не тащим сюда glossary / новости — это «быстрый» поиск для повседневного
// «куда мне сейчас пойти». Полный /search всё равно остался.
export default function HeaderSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [novels, setNovels] = useState<NovelHit[]>([]);
  const [translators, setTranslators] = useState<TranslatorHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);

  // Закрытие на клик вне
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const run = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setNovels([]);
      setTranslators([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const pattern = `%${q.replace(/[%_]/g, '\\$&')}%`;

    const [novelsRes, transRes] = await Promise.all([
      supabase
        .from('novels_view')
        .select('id, firebase_id, title, author, cover_url')
        .eq('moderation_status', 'published')
        .or(
          [
            `title.ilike.${pattern}`,
            `title_en.ilike.${pattern}`,
            `title_original.ilike.${pattern}`,
            `author.ilike.${pattern}`,
          ].join(',')
        )
        .limit(5),
      supabase
        .from('public_profiles')
        .select('id, user_name, translator_slug, translator_display_name, translator_avatar_url, avatar_url, role, is_admin')
        .or(
          [
            `user_name.ilike.${pattern}`,
            `translator_display_name.ilike.${pattern}`,
            `translator_slug.ilike.${pattern}`,
          ].join(',')
        )
        .limit(10),
    ]);

    setNovels(
      ((novelsRes.data ?? []) as Array<Record<string, unknown>>).map((n) => ({
        id: n.id as number,
        firebase_id: n.firebase_id as string,
        title: (n.title as string) ?? '',
        author: (n.author as string | null) ?? null,
        cover_url: (n.cover_url as string | null) ?? null,
      }))
    );

    const transHits: TranslatorHit[] = [];
    for (const row of (transRes.data ?? []) as Array<Record<string, unknown>>) {
      const role = row.role as string | null;
      const isAdmin = row.is_admin === true;
      if (!(isAdmin || role === 'translator' || role === 'admin')) continue;
      const slug =
        (row.translator_slug as string | null) ??
        (row.user_name as string | null) ??
        null;
      const name =
        (row.translator_display_name as string | null) ??
        (row.user_name as string | null) ??
        'Переводчик';
      transHits.push({
        id: row.id as string,
        name,
        slug,
        avatar_url:
          (row.translator_avatar_url as string | null) ??
          (row.avatar_url as string | null) ??
          null,
      });
      if (transHits.length >= 3) break;
    }
    setTranslators(transHits);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setNovels([]);
      setTranslators([]);
      return;
    }
    debounceRef.current = window.setTimeout(() => run(query), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, run]);

  // Плоский список для стрелочной навигации
  const flatItems: Array<{ kind: 'novel' | 'translator' | 'all'; href: string }> = [
    ...novels.map((n) => ({ kind: 'novel' as const, href: `/novel/${n.firebase_id}` })),
    ...translators
      .filter((t) => t.slug)
      .map((t) => ({ kind: 'translator' as const, href: `/t/${t.slug}` })),
    { kind: 'all' as const, href: `/search?q=${encodeURIComponent(query)}` },
  ];

  const submit = () => {
    const q = query.trim();
    if (!q) return;
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(q)}`);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(flatItems.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(-1, i - 1));
    } else if (e.key === 'Enter') {
      if (activeIdx >= 0 && flatItems[activeIdx]) {
        e.preventDefault();
        setOpen(false);
        router.push(flatItems[activeIdx].href);
      } else {
        e.preventDefault();
        submit();
      }
    }
  };

  const hasSuggestions =
    query.trim().length >= 2 && (novels.length > 0 || translators.length > 0 || loading);

  return (
    <div className="search-box" ref={wrapRef}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        role="search"
      >
        <input
          ref={inputRef}
          type="search"
          name="q"
          placeholder="Поиск: название, автор, переводчик…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIdx(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          autoComplete="off"
        />
      </form>

      {open && hasSuggestions && (
        <div className="search-dropdown" role="listbox">
          {loading && novels.length === 0 && translators.length === 0 && (
            <div className="search-dropdown-empty">Ищем…</div>
          )}

          {novels.length > 0 && (
            <div className="search-dropdown-group">
              <div className="search-dropdown-title">Новеллы</div>
              {novels.map((n, i) => {
                const idx = i;
                const cover = getCoverUrl(n.cover_url);
                return (
                  <Link
                    key={n.id}
                    href={`/novel/${n.firebase_id}`}
                    className={`search-dropdown-item${activeIdx === idx ? ' is-active' : ''}`}
                    onClick={() => setOpen(false)}
                    role="option"
                    aria-selected={activeIdx === idx}
                  >
                    <div className="search-dropdown-cover">
                      {cover ? (
                        <img src={cover} alt="" />
                      ) : (
                        <span aria-hidden="true">📖</span>
                      )}
                    </div>
                    <div className="search-dropdown-body">
                      <div className="search-dropdown-name">{n.title}</div>
                      {n.author && (
                        <div className="search-dropdown-meta">{n.author}</div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {translators.length > 0 && (
            <div className="search-dropdown-group">
              <div className="search-dropdown-title">Переводчики</div>
              {translators.map((t, i) => {
                const idx = novels.length + i;
                return (
                  <Link
                    key={t.id}
                    href={t.slug ? `/t/${t.slug}` : '#'}
                    className={`search-dropdown-item${activeIdx === idx ? ' is-active' : ''}`}
                    onClick={() => setOpen(false)}
                    role="option"
                    aria-selected={activeIdx === idx}
                  >
                    <div className="search-dropdown-cover search-dropdown-cover--round">
                      {t.avatar_url ? (
                        <img src={t.avatar_url} alt="" />
                      ) : (
                        <span aria-hidden="true">🧑</span>
                      )}
                    </div>
                    <div className="search-dropdown-body">
                      <div className="search-dropdown-name">{t.name}</div>
                      <div className="search-dropdown-meta">переводчик</div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          <Link
            href={`/search?q=${encodeURIComponent(query)}`}
            className={`search-dropdown-all${
              activeIdx === novels.length + translators.length ? ' is-active' : ''
            }`}
            onClick={() => setOpen(false)}
            role="option"
            aria-selected={activeIdx === novels.length + translators.length}
          >
            Все результаты по «{query.trim()}» →
          </Link>
        </div>
      )}
    </div>
  );
}
