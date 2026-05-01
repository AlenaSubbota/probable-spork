import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import NewsCard, { type NewsItem } from '@/components/news/NewsCard';
import { isJournalType, newsTypeMeta } from '@/lib/news';
import MarkSeenOnMount from '../MarkSeenOnMount';

interface PageProps {
  params: Promise<{ id: string }>;
}

function stripHtmlToPlain(html: string | null | undefined, max = 200): string {
  if (!html) return '';
  const text = String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    return { title: 'Новость не найдена', robots: { index: false, follow: false } };
  }

  const supabase = await createClient();
  const { data: news } = await supabase
    .from('news_posts')
    .select('title, subtitle, body, cover_url, is_published, published_at')
    .eq('id', numId)
    .maybeSingle();

  if (!news) {
    return { title: 'Новость не найдена', robots: { index: false, follow: false } };
  }

  const title = news.title || 'Новость';
  const description =
    news.subtitle?.trim() || stripHtmlToPlain(news.body, 200) || 'Новости и журнал Chaptify';
  const images = news.cover_url ? [{ url: news.cover_url }] : undefined;

  return {
    title,
    description,
    openGraph: {
      type: 'article',
      title,
      description,
      images,
      publishedTime: news.published_at ?? undefined,
    },
    twitter: {
      card: images ? 'summary_large_image' : 'summary',
      title,
      description,
      images: images ? images.map((i) => i.url) : undefined,
    },
    robots: news.is_published ? undefined : { index: false, follow: false },
  };
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
