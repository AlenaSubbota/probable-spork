import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import NewsForm from '@/components/admin/NewsForm';
import type { NewsType } from '@/lib/news';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditNewsPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  const p = profile as { role?: string; is_admin?: boolean } | null;
  const isAdmin = p?.is_admin === true || p?.role === 'admin';
  if (!isAdmin) redirect('/admin');

  const { data: news } = await supabase
    .from('news_posts')
    .select('*')
    .eq('id', parseInt(id, 10))
    .single();
  if (!news) notFound();

  return (
    <main className="container admin-page">
      <div className="admin-breadcrumbs">
        <Link href="/admin">Админка</Link>
        <span>/</span>
        <Link href="/admin/news">Новости</Link>
        <span>/</span>
        <span>Редактирование</span>
      </div>

      <h1>{news.title}</h1>

      <NewsForm
        mode="edit"
        initial={{
          id: news.id,
          title: news.title,
          subtitle: news.subtitle ?? '',
          bodyHtml: news.body ?? '',
          body: '',
          type: (news.type as NewsType) ?? 'announcement',
          cover_url: news.cover_url ?? '',
          rubrics: Array.isArray(news.rubrics) ? news.rubrics : [],
          is_pinned: !!news.is_pinned,
          is_published: !!news.is_published,
          attached_novel_id: news.attached_novel_id,
        }}
      />
    </main>
  );
}
