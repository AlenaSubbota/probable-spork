'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { timeAgo } from '@/lib/format';

export interface Quote {
  id: number;
  novel_id: number;
  chapter_number: number;
  quote_text: string;
  note: string | null;
  created_at: string;
  novel_firebase_id: string;
  novel_title: string;
}

interface Props {
  initial: Quote[];
}

// Киллер-фича #1 профиля: коллекция сохранённых цитат из читалки.
// Группирует по новеллам, показывает до 3-х цитат на новеллу + «ещё N».
export default function QuoteCollection({ initial }: Props) {
  const [quotes, setQuotes] = useState<Quote[]>(initial);
  const [expandedNovels, setExpandedNovels] = useState<Set<number>>(new Set());

  const handleDelete = async (id: number) => {
    if (!confirm('Удалить цитату из коллекции?')) return;
    const supabase = createClient();
    const { error } = await supabase.from('user_quotes').delete().eq('id', id);
    if (error) {
      alert(error.message);
      return;
    }
    setQuotes((prev) => prev.filter((q) => q.id !== id));
  };

  const toggleExpand = (novelId: number) => {
    setExpandedNovels((prev) => {
      const next = new Set(prev);
      if (next.has(novelId)) next.delete(novelId);
      else next.add(novelId);
      return next;
    });
  };

  // Группируем по новеллам
  const grouped = new Map<number, { novel: { id: number; firebase_id: string; title: string }; items: Quote[] }>();
  for (const q of quotes) {
    const existing = grouped.get(q.novel_id);
    if (existing) {
      existing.items.push(q);
    } else {
      grouped.set(q.novel_id, {
        novel: { id: q.novel_id, firebase_id: q.novel_firebase_id, title: q.novel_title },
        items: [q],
      });
    }
  }

  if (quotes.length === 0) {
    return (
      <section className="section">
        <div className="section-head">
          <h2>Мои цитаты</h2>
        </div>
        <div className="empty-state">
          <p>
            Пока ни одной сохранённой цитаты. Выделяй любые фразы в тексте
            главы — рядом появится кнопка «⊹ Сохранить цитату».
          </p>
          <Link href="/catalog" className="btn btn-ghost">
            К каталогу
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="section">
      <div className="section-head">
        <h2>Мои цитаты</h2>
        <span className="more" style={{ cursor: 'default' }}>
          {quotes.length} {pluralRu(quotes.length, 'цитата', 'цитаты', 'цитат')} из{' '}
          {grouped.size} {pluralRu(grouped.size, 'новеллы', 'новелл', 'новелл')}
        </span>
      </div>

      <div className="quote-groups">
        {Array.from(grouped.values()).map(({ novel, items }) => {
          const isExpanded = expandedNovels.has(novel.id);
          const visible = isExpanded ? items : items.slice(0, 3);
          return (
            <div key={novel.id} className="quote-group">
              <div className="quote-group-head">
                <Link href={`/novel/${novel.firebase_id}`} className="quote-group-title">
                  {novel.title}
                </Link>
                <span className="quote-group-count">
                  {items.length} {pluralRu(items.length, 'цитата', 'цитаты', 'цитат')}
                </span>
              </div>

              <div className="quote-list">
                {visible.map((q) => (
                  <div key={q.id} className="quote-item">
                    <blockquote className="quote-text">«{q.quote_text}»</blockquote>
                    <div className="quote-meta">
                      <Link
                        href={`/novel/${novel.firebase_id}/${q.chapter_number}`}
                        className="quote-context"
                      >
                        → глава {q.chapter_number}
                      </Link>
                      <span className="quote-time">{timeAgo(q.created_at)}</span>
                      <button
                        type="button"
                        className="quote-delete"
                        onClick={() => handleDelete(q.id)}
                        title="Удалить"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {items.length > 3 && (
                <button
                  type="button"
                  className="quote-expand"
                  onClick={() => toggleExpand(novel.id)}
                >
                  {isExpanded
                    ? 'Свернуть'
                    : `Показать ещё ${items.length - 3}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function pluralRu(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
