import { redirect } from 'next/navigation';

interface PageProps {
  params: Promise<{ id: string; chapterNum: string }>;
}

// Legacy-редирект для уведомлений, отправленных ботом до перехода на
// новую URL-схему. Старые ссылки:
//   /novel/<id>/chapter/<n>           → /novel/<id>/<n>     (читалка)
//   /novel/<id>/chapter/0[#comment-N] → /novel/<id>/reviews (отзывы;
//      n=0 в tene = «отзыв на новеллу», теперь это отдельный таб).
export default async function ChapterRedirect({ params }: PageProps) {
  const { id, chapterNum } = await params;

  if (chapterNum === '0') {
    redirect(`/novel/${encodeURIComponent(id)}/reviews`);
  }

  redirect(`/novel/${encodeURIComponent(id)}/${encodeURIComponent(chapterNum)}`);
}
