import { createClient } from '@/utils/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import NovelHero from '@/components/novel/NovelHero';
import CommentsSection from '@/components/CommentsSection';
import { findNovelByParam } from '@/lib/novel-lookup';

interface PageProps {
  params: Promise<{ id: string }>;
}

// Страница «Отзывы» — отдельный роут /novel/<id>/reviews. Шапка с
// обложкой/звёздами/табами рендерится через общий <NovelHero>; ниже —
// блок отзывов через CommentsSection с chapter_number=0.
export default async function NovelReviewsPage({ params }: PageProps) {
  const { id } = await params;

  // findNovelByParam принимает и firebase_id (chaptify-канон), и
  // numeric id (формат tene-бота уведомлений) — иначе старые ссылки
  // /novel/27/chapter/0 → /novel/27/reviews падают в 404, потому что
  // "27" в БД лежит как novels.id, а в URL мы привыкли видеть
  // firebase_id-строку.
  const supabase = await createClient();
  const { data: novel } = await findNovelByParam(supabase, id, 'id, moderation_status');

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
