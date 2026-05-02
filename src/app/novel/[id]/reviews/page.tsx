import { createClient } from '@/utils/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import NovelHero from '@/components/novel/NovelHero';
import CommentsSection from '@/components/CommentsSection';

interface PageProps {
  params: Promise<{ id: string }>;
}

// Страница «Отзывы» — отдельный роут /novel/<id>/reviews. Шапка с
// обложкой/звёздами/табами рендерится через общий <NovelHero>; ниже —
// блок отзывов через CommentsSection с chapter_number=0.
export default async function NovelReviewsPage({ params }: PageProps) {
  const { id } = await params;

  // Нам нужен только novel.id (числовой PK) для CommentsSection.
  // Делаем минимальный запрос, NovelHero сам тянет остальное.
  const supabase = await createClient();
  const { data: novel } = await supabase
    .from('novels_view')
    .select('id, moderation_status')
    .eq('firebase_id', id)
    .maybeSingle();

  if (!novel) notFound();

  return (
    <main>
      <NovelHero firebaseId={id} />

      <section
        id="reviews"
        className="container section novel-reviews-block"
      >
        <CommentsSection
          novelId={novel.id}
          chapterNumber={0}
          heading="Отзывы"
          inputPlaceholder="Что понравилось, что нет — пара строк уже помогает другим читателям выбрать."
          emptyText="Отзывов пока нет. Стань первым — переводчику и читателям важно твоё мнение."
          guestPrompt={
            <>
              <Link href="/login" className="more">Войти</Link>, чтобы оставить отзыв.
            </>
          }
        />
      </section>
    </main>
  );
}
