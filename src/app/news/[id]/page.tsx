import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import NewsCard, { type NewsItem } from '@/components/news/NewsCard';
import { isJournalType, newsTypeMeta } from '@/lib/news';
import MarkSeenOnMount from '../MarkSeenOnMount';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SingleNewsPage({ params }: PageProps) {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) notFound();

  const supabase = await createClient();

  const { data: news } = await supabase
    .from('news_posts')
    .select('id, title, subtitle, body, type, cover_url, rubrics, is_pinned, created_at, published_at, attached_novel_id, is_published')
    .eq('id', numId)
    .single();

  if (!news || !news.is_published) {
    // Проверяем — не админ ли смотрит свой черновик
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) notFound();
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();
    const p = profile as { role?: string; is_admin?: boolean } | null;
    const isAdmin = p?.is_admin === true || p?.role === 'admin';
    if (!isAdmin) notFound();
  }
  if (!news) notFound();

  let attached_novel: NewsItem['attached_novel'] = null;
  if (news.attached_novel_id) {
    const { data: n } = await supabase
      .from('novels')
      .select('firebase_id, title, cover_url')
      .eq('id', news.attached_novel_id)
      .maybeSingle();
    attached_novel = n ?? null;
  }

  const item: NewsItem = {
    id: news.id,
    title: news.title,
    body: news.body,
    type: news.type,
    is_pinned: !!news.is_pinned,
    created_at: news.created_at,
    published_at: news.published_at,
    attached_novel_id: news.attached_novel_id,
    attached_novel,
  };

  const isJournal = isJournalType(news.type);
  const rubrics: string[] = Array.isArray(news.rubrics) ? news.rubrics : [];
  const typeMeta = newsTypeMeta(news.type);

  return (
    <main className="container section" style={{ maxWidth: 820 }}>
      <div className="admin-breadcrumbs">
        <Link href="/news">Новости</Link>
        <span>/</span>
        <span>{news.title}</span>
      </div>

      {isJournal && (news.cover_url || news.subtitle) && (
        <header className="news-article-hero">
          {news.cover_url && (
            <div className="news-article-hero-cover">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={news.cover_url} alt="" />
            </div>
          )}
          <div className="journal-card-rubrics" style={{ marginBottom: 8 }}>
            <span className={`journal-rubric journal-rubric--${typeMeta.tone}`}>
              {typeMeta.label}
            </span>
            {rubrics.map((r) => (
              <span key={r} className="journal-rubric">
                {r}
              </span>
            ))}
          </div>
          {news.subtitle && (
            <p className="news-article-subtitle">{news.subtitle}</p>
          )}
        </header>
      )}

      <NewsCard news={item} />

      <div style={{ marginTop: 24 }}>
        <Link href="/news" className="btn btn-ghost">
          ← Все новости
        </Link>
      </div>

      <MarkSeenOnMount maxId={news.id} />
    </main>
  );
}
