import { redirect } from 'next/navigation';

interface PageProps {
  params: Promise<{ id: string; chapterNum: string }>;
}

// Legacy-редирект: уведомления, отправленные ботом до перехода на
// новую URL-схему, ссылались на /novel/<id>/chapter/<n>. Текущий
// канон — /novel/<id>/<n> (без /chapter/), но в БД уже лежат старые
// ссылки + индексация поисковиков. Просто перекидываем 308'ом.
export default async function ChapterRedirect({ params }: PageProps) {
  const { id, chapterNum } = await params;
  redirect(`/novel/${encodeURIComponent(id)}/${encodeURIComponent(chapterNum)}`);
}
