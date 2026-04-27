import { redirect } from 'next/navigation';

// Обсуждение главы переехало внутрь самой читалки — финальной snap-страницей
// (см. commentsSlot в src/app/novel/[id]/[chapterNum]/page.tsx). Старый
// маршрут /discussion больше не нужен; редиректим на главу, чтобы внешние
// ссылки и история браузера не упирались в 404.

interface PageProps {
  params: Promise<{ id: string; chapterNum: string }>;
}

export default async function ChapterDiscussionPage({ params }: PageProps) {
  const { id, chapterNum } = await params;
  redirect(`/novel/${id}/${chapterNum}`);
}
