'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { getCoverUrl, cleanGenres } from '@/lib/format';

interface NovelHit {
  id: number;
  firebase_id: string;
  title: string;
  title_en?: string | null;
  title_original?: string | null;
  author: string | null;
  cover_url: string | null;
  genres: string[] | null;
  average_rating: number | null;
  chapter_count: number | null;
  matched_field?: string;
}

interface GlossaryHit {
  novel_id: number;
  novel_firebase_id: string;
  novel_title: string;
  term_original: string;
  term_translation: string;
  category: string | null;
}

interface NewsHit {
  id: number;
  title: string;
  subtitle: string | null;
  type: string;
  created_at: string;
  matched_field: string;
}

interface TranslatorHit {
  id: string;
  display_name: string;
  slug: string | null;
  about: string | null;
  avatar_url: string | null;
}

const COMMON_GENRES = [
  'Романтика', 'Фэнтези', 'Ромфэнтези', 'Драма', 'Комедия', 'Экшен',
  'Приключения', 'Психология', 'Мистика', 'Триллер', 'Школа', 'Сянься',
];

function norm(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').trim();
}

function levenshtein(a: string, b: string): number {
  const la = a.length, lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  const dp = Array.from({ length: la + 1 }, () => new Array(lb + 1).fill(0));
  for (let i = 0; i <= la; i++) dp[i][0] = i;
  for (let j = 0; j <= lb; j++) dp[0][j] = j;
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[la][lb];
}

export default function SearchClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const initialQuery = sp.get('q') ?? '';

  const [query, setQuery] = useState(initialQuery);
  const [novels, setNovels] = useState<NovelHit[]>([]);
  const [glossary, setGlossary] = useState<GlossaryHit[]>([]);
  const [news, setNews] = useState<NewsHit[]>([]);
  const [translators, setTranslators] = useState<TranslatorHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<number | null>(null);

  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setNovels([]);
      setGlossary([]);
      setNews([]);
      setTranslators([]);
      setSearched(false);
      return;
    }

    setSearching(true);
    const supabase = createClient();
    const pattern = `%${q.replace(/[%_]/g, '\\$&')}%`;

    // Пытаемся идти через trigram RPC (нечёткий поиск, ловит опечатки
    // и ранжирует по similarity). Если миграция 021 ещё не накачена —
    // silently падаем на обычный ilike.
    let novelsData: Record<string, unknown>[] | null = null;
    let usedTrgm = false;
    try {
      const { data: rpcData, error: rpcErr } = await supabase.rpc(
        'search_novels_trgm',
        { p_q: q, p_lim: 20 }
      );
      if (!rpcErr && Array.isArray(rpcData)) {
        novelsData = rpcData as Record<string, unknown>[];
        usedTrgm = true;
      }
    } catch {
      // падаем в ilike ниже
    }

    let glossaryRes: { data: Array<{ novel_id: number; term_original: string; term_translation: string; category: string | null }> | null };

    if (!usedTrgm) {
      const [novelsRes, gRes] = await Promise.all([
        supabase
          .from('novels_view')
          .select(
            'id, firebase_id, title, title_en, title_original, author, cover_url, genres, average_rating, chapter_count'
          )
          .eq('moderation_status', 'published')
          .or(
            [
              `title.ilike.${pattern}`,
              `title_en.ilike.${pattern}`,
              `title_original.ilike.${pattern}`,
              `author.ilike.${pattern}`,
              `description.ilike.${pattern}`,
            ].join(',')
          )
          .limit(20),
        supabase
          .from('novel_glossaries')
          .select('novel_id, term_original, term_translation, category')
          .or(`term_original.ilike.${pattern},term_translation.ilike.${pattern}`)
          .limit(20),
      ]);
      novelsData = novelsRes.data as Record<string, unknown>[] | null;
      glossaryRes = gRes;
    } else {
      const gRes = await supabase
        .from('novel_glossaries')
        .select('novel_id, term_original, term_translation, category')
        .or(`term_original.ilike.${pattern},term_translation.ilike.${pattern}`)
        .limit(20);
      glossaryRes = gRes;
    }

    const novelHits: NovelHit[] = (novelsData ?? []).map((n) => {
      const nq = norm(q);
      const title = (n.title as string | null) ?? '';
      const titleEn = (n.title_en as string | null) ?? null;
      const titleOrig = (n.title_original as string | null) ?? null;
      const author = (n.author as string | null) ?? null;
      let matched_field = 'Название';
      if (title && norm(title).includes(nq)) matched_field = 'Название';
      else if (titleEn && norm(titleEn).includes(nq)) matched_field = 'English';
      else if (titleOrig && norm(titleOrig).includes(nq)) matched_field = 'Оригинал';
      else if (author && norm(author).includes(nq)) matched_field = 'Автор';
      else matched_field = usedTrgm ? 'Похоже на запрос' : 'Описание';
      return {
        id: n.id as number,
        firebase_id: n.firebase_id as string,
        title,
        title_en: titleEn,
        title_original: titleOrig,
        author,
        cover_url: (n.cover_url as string | null) ?? null,
        genres: cleanGenres(n.genres),
        average_rating: (n.average_rating as number | null) ?? null,
        chapter_count: (n.chapter_count as number | null) ?? null,
        matched_field,
      };
    });

    setNovels(novelHits);

    // Глоссарные хиты — подтягиваем названия новелл
    const glossaryRows = glossaryRes.data ?? [];
    let glossaryHits: GlossaryHit[] = [];
    if (glossaryRows.length > 0) {
      const gNovelIds = Array.from(new Set(glossaryRows.map((g) => g.novel_id)));
      const { data: gNovels } = await supabase
        .from('novels')
        .select('id, firebase_id, title')
        .in('id', gNovelIds);
      const novelMap = new Map((gNovels ?? []).map((n) => [n.id, n]));
      glossaryHits = glossaryRows
        .map((g) => {
          const n = novelMap.get(g.novel_id);
          if (!n) return null;
          return {
            novel_id: g.novel_id,
            novel_firebase_id: n.firebase_id,
            novel_title: n.title,
            term_original: g.term_original,
            term_translation: g.term_translation,
            category: g.category,
          };
        })
        .filter((x): x is GlossaryHit => x !== null);
    }
    setGlossary(glossaryHits);

    // ---- Поиск по новостям ----
    // Тянем по title + subtitle + body. Только опубликованные.
    const { data: newsRows } = await supabase
      .from('news_posts')
      .select('id, title, subtitle, body, type, created_at, is_published')
      .eq('is_published', true)
      .or(
        [
          `title.ilike.${pattern}`,
          `subtitle.ilike.${pattern}`,
          `body.ilike.${pattern}`,
        ].join(',')
      )
      .order('created_at', { ascending: false })
      .limit(10);

    const newsHits: NewsHit[] = (newsRows ?? []).map((n) => {
      const nq = norm(q);
      const title = (n.title as string | null) ?? '';
      const subtitle = (n.subtitle as string | null) ?? null;
      const body = (n.body as string | null) ?? null;
      let matched_field = 'Заголовок';
      if (title && norm(title).includes(nq)) matched_field = 'Заголовок';
      else if (subtitle && norm(subtitle).includes(nq)) matched_field = 'Подзаголовок';
      else if (body && norm(body).includes(nq)) matched_field = 'Текст';
      return {
        id: n.id as number,
        title,
        subtitle,
        type: (n.type as string) ?? 'announcement',
        created_at: (n.created_at as string) ?? '',
        matched_field,
      };
    });
    setNews(newsHits);

    // ---- Поиск по переводчикам ----
    // Идём через public_profiles (мигр. 040), фильтруем по роли
    // translator/admin. У не-переводчиков отдельной публичной страницы
    // нет — их в общую выдачу не пускаем, чтобы не вышло «случайных
    // профилей в результатах».
    const { data: tRows } = await supabase
      .from('public_profiles')
      .select('id, user_name, translator_slug, translator_display_name, translator_avatar_url, avatar_url, translator_about, role, is_admin')
      .or(
        [
          `user_name.ilike.${pattern}`,
          `translator_display_name.ilike.${pattern}`,
          `translator_slug.ilike.${pattern}`,
          `translator_about.ilike.${pattern}`,
        ].join(',')
      )
      .limit(20);

    const translatorHits: TranslatorHit[] = (tRows ?? [])
      .filter((r) => {
        const rr = r as { role?: string; is_admin?: boolean };
        return rr.is_admin === true || rr.role === 'translator' || rr.role === 'admin';
      })
      .slice(0, 8)
      .map((r) => {
        const rr = r as {
          id: string;
          user_name: string | null;
          translator_slug: string | null;
          translator_display_name: string | null;
          translator_avatar_url: string | null;
          avatar_url: string | null;
          translator_about: string | null;
        };
        return {
          id: rr.id,
          display_name: rr.translator_display_name || rr.user_name || 'Переводчик',
          slug: rr.translator_slug || rr.user_name || null,
          about: rr.translator_about,
          avatar_url: rr.translator_avatar_url || rr.avatar_url,
        };
      });
    setTranslators(translatorHits);

    setSearching(false);
    setSearched(true);

    // Синхронизируем URL без перезагрузки
    const usp = new URLSearchParams();
    usp.set('q', q);
    router.replace(`/search?${usp.toString()}`, { scroll: false });
  }, [router]);

  // Debounce
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      runSearch(query);
    }, 260);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  // Начальный запрос из URL
  useEffect(() => {
    if (initialQuery) runSearch(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // «Возможно, вы хотели» — ищем ближайший жанр по Левенштейну
  const didYouMean = useMemo(() => {
    if (!query || novels.length > 0 || glossary.length > 0 || news.length > 0 || translators.length > 0 || query.length < 3) return null;
    const nq = norm(query);
    const candidates = COMMON_GENRES.map((g) => ({
      genre: g,
      dist: levenshtein(nq, norm(g)),
    }));
    candidates.sort((a, b) => a.dist - b.dist);
    const best = candidates[0];
    if (best && best.dist <= Math.max(2, Math.floor(nq.length * 0.35))) {
      return best.genre;
    }
    return null;
  }, [query, novels, glossary, news, translators]);

  return (
    <>
      <div className="search-hero">
        <input
          type="search"
          className="search-input-big"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Название, автор, персонаж, термин…"
          autoFocus
        />
        <div className="search-hint">
          {searching ? 'Ищем…' : query.length < 2 ? 'Начни печатать — результаты появятся мгновенно.' : ''}
        </div>
      </div>

      {searched && query.length >= 2 && novels.length === 0 && glossary.length === 0 && news.length === 0 && translators.length === 0 && (
        <div className="empty-state">
          <p>По запросу «{query}» ничего не найдено.</p>
          {didYouMean && (
            <p style={{ marginTop: 8, color: 'var(--accent)' }}>
              Возможно, вы имели в виду{' '}
              <Link href={`/catalog?genre=${encodeURIComponent(didYouMean)}`} className="more">
                {didYouMean}
              </Link>
              ?
            </p>
          )}
          <Link href="/catalog" className="btn btn-ghost">К каталогу</Link>
        </div>
      )}

      {translators.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Переводчики <span className="search-source-badge">профили</span></h2>
            <span className="more" style={{ cursor: 'default' }}>
              {translators.length}
            </span>
          </div>
          <div className="search-translators-grid">
            {translators.map((t) => (
              <Link
                key={t.id}
                href={t.slug ? `/t/${t.slug}` : `/u/${t.id}`}
                className="search-translator-card"
              >
                <div className="search-translator-avatar">
                  {t.avatar_url ? (
                    <img src={t.avatar_url} alt="" />
                  ) : (
                    <span>{t.display_name.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className="search-translator-body">
                  <div className="search-translator-name">{t.display_name}</div>
                  {t.about && (
                    <div className="search-translator-about">{t.about}</div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {novels.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Новеллы <span className="search-source-badge">каталог</span></h2>
            <span className="more" style={{ cursor: 'default' }}>
              {novels.length}
            </span>
          </div>
          <div className="search-results">
            {novels.map((n) => {
              const cover = getCoverUrl(n.cover_url);
              return (
                <Link key={n.id} href={`/novel/${n.firebase_id}`} className="search-result-row">
                  <div className="search-result-cover">
                    {cover ? (
                      <img src={cover} alt={n.title} />
                    ) : (
                      <div className="placeholder p1" style={{ fontSize: 10 }}>
                        {n.title}
                      </div>
                    )}
                  </div>
                  <div className="search-result-body">
                    <div className="search-result-title">{n.title}</div>
                    <div className="search-result-meta">
                      {n.author && <span>{n.author}</span>}
                      <span>·</span>
                      <span>{n.chapter_count ?? 0} гл.</span>
                      {n.average_rating && (
                        <>
                          <span>·</span>
                          <span>★ {Number(n.average_rating).toFixed(1)}</span>
                        </>
                      )}
                    </div>
                    {n.matched_field && n.matched_field !== 'Название' && (
                      <div className="search-result-matched">
                        Совпало: {n.matched_field}
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {news.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Новости <span className="search-source-badge">журнал</span></h2>
            <span className="more" style={{ cursor: 'default' }}>
              {news.length}
            </span>
          </div>
          <div className="search-news-list">
            {news.map((n) => (
              <Link key={n.id} href={`/news/${n.id}`} className="search-news-row">
                <div className="search-news-body">
                  <div className="search-news-title">{n.title}</div>
                  {n.subtitle && (
                    <div className="search-news-subtitle">{n.subtitle}</div>
                  )}
                  {n.matched_field !== 'Заголовок' && (
                    <div className="search-result-matched">
                      Совпало: {n.matched_field}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {glossary.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Термины и персонажи <span className="search-source-badge">глоссарии</span></h2>
            <span className="more" style={{ cursor: 'default' }}>
              {glossary.length}
            </span>
          </div>
          <div className="search-glossary-list">
            {glossary.map((g, i) => (
              <Link
                key={`${g.novel_id}-${i}`}
                href={`/novel/${g.novel_firebase_id}`}
                className="search-glossary-row"
              >
                <div className="search-glossary-term">
                  <code>{g.term_original}</code>
                  <span>→</span>
                  <span>{g.term_translation}</span>
                </div>
                <div className="search-glossary-novel">
                  из «{g.novel_title}»
                  {g.category && <span className="note" style={{ marginLeft: 8, fontSize: 10 }}>{g.category}</span>}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
