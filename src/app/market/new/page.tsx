import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import ListingForm from '../ListingForm';

export const metadata = { title: 'Новое объявление — Маркетплейс' };

export default async function NewListingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/market/new');

  // Подтянем новеллы пользователя — для выбора «объявление по конкретной новелле»
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
        <span>Новое объявление</span>
      </div>

      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-serif)', margin: '0 0 6px' }}>
          Кто нужен в команду?
        </h1>
        <p style={{ color: 'var(--ink-mute)', margin: 0 }}>
          Расскажи, какая роль и условия. Хорошее объявление — конкретное:
          объём работы, срок, что можешь предложить взамен.
        </p>
      </header>

      <ListingForm
        mode="create"
        myNovels={myNovels ?? []}
      />
    </main>
  );
}
