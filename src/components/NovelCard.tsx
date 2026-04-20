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

export const NovelCard = ({ id, title, coverUrl, rating, chaptersCount, translatorName, isHot }: NovelCardProps) => {
  return (
    <Link href={`/novel/${id}`} className="novel-card group flex flex-col gap-2">
      <div className="novel-cover relative aspect-[3/4] rounded-[12px] overflow-hidden bg-[var(--accent-soft)] shadow-sm transition-all group-hover:-translate-y-1 group-hover:shadow-md">
        {coverUrl ? (
          <Image 
            src={coverUrl} 
            alt={title} 
            fill 
            className="object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-center p-3 text-[var(--surface)] font-serif bg-gradient-to-br from-[#8C5A3C] to-[#C9A35F]">
            {title}
          </div>
        )}
        <span className="absolute top-2 left-2 bg-black/55 backdrop-blur-md text-white px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1">
          <span className="text-[var(--gold)]">★</span>{rating.toFixed(1)}
        </span>
        {isHot && <span className="absolute bottom-2 left-2 bg-[var(--accent)] text-white px-2 py-1 rounded-md text-[10px] font-bold uppercase">HOT</span>}
      </div>
      <div className="novel-title text-[13.5px] font-semibold leading-snug line-clamp-2 text-[var(--ink)]">
        {title}
      </div>
      <div className="novel-meta text-[11.5px] text-[var(--ink-mute)] flex gap-2 items-center">
        <span className="text-[var(--accent)] font-semibold">{translatorName}</span>
        <span>· {chaptersCount} гл.</span>
      </div>
    </Link>
  );
};