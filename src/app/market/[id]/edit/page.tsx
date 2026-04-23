import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import ListingForm from '../../ListingForm';
import type { MarketplaceRole, Compensation, ListingStatus } from '@/lib/marketplace';

interface PageProps {
  params: Promise<{ id: string }>;
}

export const metadata = { title: 'Редактирование объявления — Маркетплейс' };

export default async function EditListingPage({ params }: PageProps) {
  const { id } = await params;
  const listingId = parseInt(id, 10);
  if (!Number.isFinite(listingId)) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/market/${listingId}/edit`);

  const { data: listing } = await supabase
    .from('marketplace_listings')
    .select('*')
    .eq('id', listingId)
    .maybeSingle();

  if (!listing) notFound();
  if (listing.author_id !== user.id) {
    // Не автор — и не админ? проверка через RLS уже не даст update, но
    // UI перестрахуемся: заворачиваем обратно на просмотр.
    redirect(`/market/${listingId}`);
  }

  const { data: myNovels } = await supabase
    .from('novels')
    .select('id, firebase_id, title')
    .eq('translator_id', user.id)
    .order('title', { ascending: true });

  return (
    <main className="container section" style={{ maxWidth: 760 }}>
      <div className="admin-breadcrumbs">
        <Link href="/market">Маркетплейс</Link>
        <span>/</span>
        <Link href={`/market/${listingId}`}>{(listing.title as string).slice(0, 40)}</Link>
        <span>/</span>
        <span>Редактировать</span>
      </div>

      <ListingForm
        mode="edit"
        initial={{
          id: listing.id as number,
          title: listing.title as string,
          description: listing.description as string,
          role: listing.role as MarketplaceRole,
          compensation: listing.compensation as Compensation,
          compensation_note: listing.compensation_note as string | null,
          novel_id: listing.novel_id as number | null,
          status: listing.status as ListingStatus,
        }}
        myNovels={myNovels ?? []}
      />
    </main>
  );
}
