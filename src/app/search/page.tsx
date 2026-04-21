import { Suspense } from 'react';
import SearchClient from '@/components/search/SearchClient';

export default function SearchPage() {
  return (
    <main className="container section">
      <Suspense
        fallback={
          <div className="search-hero">
            <input className="search-input-big" placeholder="Загрузка…" disabled />
          </div>
        }
      >
        <SearchClient />
      </Suspense>
    </main>
  );
}
