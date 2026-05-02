import { redirect } from 'next/navigation';

interface PageProps {
  params: Promise<{ id: string; chapterNum: string }>;
}

// Legacy-редирект: уведомления, отправленные ботом до перехода на
// новую URL-схему, ссылались на /novel/<id>/chapter/<n>. Теперь:
//   - chapter=0 в tene-схеме означал «отзыв на новеллу» (chapter_number=0
//     в comments). У chaptify своя страница новеллы с секцией #reviews —
//     туда и редиректим, плюс пробрасываем якорь на конкретный коммент,
//     если он был в URL.
//   - остальные chapterNum → канонический /novel/<id>/<n>.
export default async function ChapterRedirect({ params }: PageProps) {
  const { id, chapterNum } = await params;

  if (chapterNum === '0') {
    redirect(`/novel/${encodeURIComponent(id)}#reviews`);
  }

  redirect(`/novel/${encodeURIComponent(id)}/${encodeURIComponent(chapterNum)}`);
}
