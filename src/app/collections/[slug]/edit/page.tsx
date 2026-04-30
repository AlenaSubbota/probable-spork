import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import CollectionForm from '@/components/collections/CollectionForm';
import type { PickedNovel } from '@/components/collections/NovelMultiPicker';

export const metadata = { title: 'Редактирование подборки — Chaptify' };

export default async function EditCollectionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/collections/${slug}/edit`);

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_admin')
    .eq('id', user.id)
    .maybeSingle();
  const p = profile as { role?: string; is_admin?: boolean } | null;
  const isAdmin = p?.is_admin === true || p?.role === 'admin';

  // Загружаем подборку через RLS — он отрежет, если нет прав на чтение.
  const { data: collection } = await supabase
    .from('collections')
    .select('id, slug, title, tagline, description, emoji, novel_ids, is_published, is_featured, owner_id')
    .eq('slug', slug)
    .maybeSingle();
  if (!collection) notFound();

  type CollectionRow = {
    id: number;
    slug: string;
    title: string;
    tagline: string | null;
    description: string | null;
    emoji: string | null;
    novel_ids: unknown;
    is_published: boolean;
    is_featured: boolean;
    owner_id: string | null;
  };
  const c = collection as CollectionRow;

  // Проверка прав на редактирование — RLS уже отдал бы ошибку при
  // попытке UPDATE, но прямую отсечку лучше делать заранее.
  const canEdit = isAdmin || c.owner_id === user.id;
  if (!canEdit) {
    redirect(`/collection/${slug}`);
  }

  // Подгружаем превью каждой новеллы из подборки, чтобы сразу
  // отрисовать в пикере.
  const novelIds: string[] = Array.isArray(c.novel_ids)
    ? (c.novel_ids as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];

  let novels: PickedNovel[] = [];
  if (novelIds.length > 0) {
    const { data: rows } = await supabase
      .from('novels')
      .select('firebase_id, title, cover_url')
      .in('firebase_id', novelIds);
    const byId = new Map(
      (rows ?? []).map((n) => [n.firebase_id as string, n as PickedNovel])
    );
    // Сохраняем порядок из novel_ids.
    novels = novelIds
      .map((id) => byId.get(id))
      .filter((x): x is PickedNovel => !!x);
  }

  return (
    <main className="container collection-edit-page">
      <div className="collection-edit-breadcrumbs">
        <Link href="/collections">Подборки</Link>
        <span>/</span>
        <Link href={`/collection/${slug}`}>{c.title}</Link>
        <span>/</span>
        <span>Редактирование</span>
      </div>
      <h1>Редактирование подборки</h1>
      <CollectionForm
        mode="edit"
        collectionId={c.id}
        isAdmin={isAdmin}
        initial={{
          slug: c.slug,
          title: c.title,
          tagline: c.tagline ?? '',
          description: c.description ?? '',
          emoji: c.emoji ?? '✦',
          is_published: c.is_published,
          is_featured: c.is_featured,
          novels,
        }}
      />
    </main>
  );
}
