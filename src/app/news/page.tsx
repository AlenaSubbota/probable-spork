import Link from 'next/link';
import { createClient } from '@/utils/supabase/server';
import NewsCard, { type NewsItem } from '@/components/news/NewsCard';
import { NEWS_TYPES, type NewsType } from '@/lib/news';
import MarkSeenOnMount from './MarkSeenOnMount';

export const metadata = { title: 'Новости — Chaptify' };

interface PageProps {
  searchParams: Promise<{ type?: string }>;
}

export default async function NewsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filter = (params.type ?? 'all') as NewsType | 'all';
  const supabase = await createClient();

  let query = supabase
    .from('news_posts')
    .select('id, title, body, type, is_pinned, created_at, published_at, attached_novel_id')
    .eq('is_published', true)
    .order('is_pinned', { ascending: false })
    .order('published_at', { ascending: false })
    .limit(40);
  if (filter !== 'all') query = query.eq('type', filter);
  const { data: newsRaw } = await query;

  // Подтягиваем привязанные новеллы одним запросом
  const attachedIds = Array.from(
    new Set(
      (newsRaw ?? [])
        .map((n) => n.attached_novel_id)
        .filter((x): x is number => !!x)
    )
  );
  let novelMap = new Map<number, { firebase_id: string; title: string; cover_url: string | null }>();
  if (attachedIds.length > 0) {
    const { data } = await supabase
      .from('novels')
      .select('id, firebase_id, title, cover_url')
      .in('id', attachedIds);
    for (const n of data ?? []) {
      novelMap.set(n.id, { firebase_id: n.firebase_id, title: n.title, cover_url: n.cover_url });
    }
  }

  const news: NewsItem[] = (newsRaw ?? []).map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    type: n.type,
    is_pinned: !!n.is_pinned,
    created_at: n.created_at,
    published_at: n.published_at,
    attached_novel_id: n.attached_novel_id,
    attached_novel: n.attached_novel_id ? novelMap.get(n.attached_novel_id) ?? null : null,
  }));

  const maxId = news.length > 0 ? Math.max(...news.map((n) => n.id)) : 0;

  return (
    <main className="container section news-page">
      <div className="admin-breadcrumbs">
        <Link href="/">Главная</Link>
        <span>/</span>
        <span>Новости</span>
      </div>
      <header className="news-head">
        <div>
          <h1>Новости Chaptify</h1>
          <p className="admin-head-sub">
            Объявления от админа, события, апдейты.
          </p>
        </div>
      </header>

      {/* Киллер-фича #1: фильтр по типу */}
      <nav className="bookmark-tabs">
        <Link
          href="/news"
          className={`bookmark-tab${filter === 'all' ? ' active' : ''}`}
        >
          Все
        </Link>
        {NEWS_TYPES.map((t) => (
          <Link
            key={t.key}
            href={`/news?type=${t.key}`}
            className={`bookmark-tab${filter === t.key ? ' active' : ''}`}
          >
            {t.emoji} {t.label}
          </Link>
        ))}
      </nav>

      {news.length === 0 ? (
        <div className="empty-state">
          <p>В этой категории пока ничего нет.</p>
          <Link href="/news" className="btn btn-ghost">
            Показать все
          </Link>
        </div>
      ) : (
        <div className="news-list">
          {news.map((n) => (
            <NewsCard key={n.id} news={n} />
          ))}
        </div>
      )}

      {/* Киллер-фича #3: автоматически помечает новости прочитанными */}
      <MarkSeenOnMount maxId={maxId} />
    </main>
  );
}
