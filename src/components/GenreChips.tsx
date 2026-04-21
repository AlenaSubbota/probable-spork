import Link from 'next/link';
 
export interface GenreCount {
  name: string;
  count: number;
}
 
interface Props {
  genres: GenreCount[];
  total: number;
}
 
export default function GenreChips({ genres, total }: Props) {
  if (genres.length === 0) return null;
 
  return (
    <section className="container section">
      <div className="section-head">
        <h2>Жанры</h2>
      </div>
      <div className="chips">
        <Link href="/catalog" className="chip active">
          Все <span className="chip-count">{total}</span>
        </Link>
        {genres.map(({ name, count }) => (
          <Link
            key={name}
            href={`/catalog?genre=${encodeURIComponent(name)}`}
            className="chip"
          >
            {name} <span className="chip-count">{count}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}