import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import NovelForm from '@/components/admin/NovelForm';

export default async function NewNovelPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_admin')
    .eq('id', user.id)
    .maybeSingle();
  const p = profile as { role?: string; is_admin?: boolean } | null;
  const isAdmin = p?.is_admin === true || p?.role === 'admin';
  const isTranslator = isAdmin || p?.role === 'translator';
  if (!isTranslator) redirect('/translator/apply');

  return (
    <main className="container admin-page">
      <div className="admin-breadcrumbs">
        <Link href="/admin">Админка</Link>
        <span>/</span>
        <span>Новая новелла</span>
      </div>

      <h1>Новая новелла</h1>
      <p style={{ color: 'var(--ink-mute)', marginBottom: 24 }}>
        {isAdmin
          ? 'Заполни карточку — новелла сразу станет опубликованной.'
          : 'Заполни карточку и сохрани как черновик. Когда всё будет готово — жми «Отправить на модерацию» на странице новеллы; админ проверит и опубликует.'}
      </p>

      <NovelForm mode="create" isAdmin={isAdmin} />
    </main>
  );
}
