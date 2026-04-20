import Image from 'next/image';
import Link from 'next/link';

interface NovelCardProps {
  id: number;
  title: string;
  coverUrl?: string;
  rating: number;
  chaptersCount: number;
  translatorName: string;
  isHot?: boolean;
}

// Экспорт должен совпадать с импортом в page.tsx
export const NovelCard = ({ id, title, coverUrl, rating, chaptersCount, translatorName, isHot }: NovelCardProps) => {
  return (
    <Link href={`/novel/${id}`} className="group flex flex-col gap-2">
      <div className="relative aspect-[3/4] rounded-[12px] overflow-hidden bg-[var(--bg-soft)] shadow-sm transition-all group-hover:-translate-y-1 group-hover:shadow-md">
        {coverUrl ? (
          <Image 
            src={coverUrl} 
            alt={title} 
            fill 
            sizes="(max-width: 768px) 50vw, 16vw"
            className="object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-200 text-gray-400">
            No cover
          </div>
        )}
      </div>
      <div className="text-[13px] font-bold leading-tight line-clamp-2">{title}</div>
      <div className="text-[11px] text-gray-500">
        <span className="text-[var(--accent)] font-bold">{translatorName}</span> • {chaptersCount} гл.
      </div>
    </Link>
  );
};