import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import CollectionForm from '@/components/collections/CollectionForm';

export const metadata = { title: 'Новая подборка — Chaptify' };

export default async function NewCollectionPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/collections/new');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_admin')
    .eq('id', user.id)
    .maybeSingle();
  const p = profile as { role?: string; is_admin?: boolean } | null;
  const isAdmin = p?.is_admin === true || p?.role === 'admin';
  const canCreate = isAdmin || p?.role === 'translator';
  if (!canCreate) {
    redirect('/collections');
  }

  return (
    <main className="container collection-edit-page">
      <div className="collection-edit-breadcrumbs">
        <Link href="/collections">Подборки</Link>
        <span>/</span>
        <span>Новая</span>
      </div>
      <h1>Новая подборка</h1>
      <p className="collection-edit-lead">
        Собери набор новелл с общей темой. Дай ему название, опиши, добавь
        обложечный эмодзи — и опубликуй, когда будешь готов(а).
      </p>
      <CollectionForm mode="create" isAdmin={isAdmin} />
    </main>
  );
}
