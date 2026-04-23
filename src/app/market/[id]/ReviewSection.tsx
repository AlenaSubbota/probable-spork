'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { timeAgo } from '@/lib/format';
import ReviewStars from '@/components/marketplace/ReviewStars';
import { useToasts, ToastStack } from '@/components/ui/Toast';

interface Counterparty {
  id: string;              // кого я могу отозвать
  name: string | null;
  avatar: string | null;
  slug: string | null;
}

interface Review {
  id: number;
  author_id: string;
  subject_id: string;
  rating: number;
  text: string | null;
  created_at: string;
  author_name: string | null;
  author_avatar: string | null;
  author_slug: string | null;
}

interface Props {
  listingId: number;
  counterparties: Counterparty[];
  currentUserId: string;
}

// Секция отзывов на закрытом листинге. Показывает:
//  - уже оставленные отзывы (все участники видят все)
//  - для каждого «контрагента» (с кем я работал по этому листингу)
//    форму «Оставить отзыв», если ещё не оставил.
export default function ReviewSection({ listingId, counterparties, currentUserId }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const { items: toasts, push, dismiss } = useToasts();

  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, { rating: number; text: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('marketplace_reviews_view')
      .select('*')
      .eq('listing_id', listingId)
      .order('created_at', { ascending: false });
    setLoading(false);
    if (error) {
      push('error', `Не загрузились: ${error.message}`);
      return;
    }
    setReviews((data ?? []) as Review[]);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId]);

  const submit = async (subjectId: string) => {
    const draft = drafts[subjectId];
    if (!draft || draft.rating < 1) {
      push('error', 'Поставь оценку от 1 до 5.');
      return;
    }
    setBusy(subjectId);
    const { error } = await supabase.from('marketplace_reviews').insert({
      listing_id: listingId,
      author_id: currentUserId,
      subject_id: subjectId,
      rating: draft.rating,
      text: (draft.text ?? '').trim() || null,
    });
    setBusy(null);
    if (error) {
      push('error', `Не получилось: ${error.message}`);
      return;
    }
    push('success', 'Отзыв опубликован.');
    setDrafts((d) => {
      const copy = { ...d };
      delete copy[subjectId];
      return copy;
    });
    await load();
    router.refresh();
  };

  // Кого я ещё не отозвал
  const alreadyReviewedSubjects = new Set(
    reviews.filter((r) => r.author_id === currentUserId).map((r) => r.subject_id),
  );
  const pending = counterparties.filter((c) => !alreadyReviewedSubjects.has(c.id));

  return (
    <section className="reviews-section">
      <div className="section-head">
        <h2>Отзывы по этому объявлению</h2>
      </div>

      {/* Формы для каждого ещё не отозванного контрагента */}
      {pending.length > 0 && (
        <div className="review-forms">
          {pending.map((cp) => {
            const draft = drafts[cp.id] ?? { rating: 0, text: '' };
            const initial = (cp.name ?? '?').trim().charAt(0).toUpperCase() || '?';
            const href = cp.slug ? `/t/${cp.slug}` : `/u/${cp.id}`;
            return (
              <div key={cp.id} className="review-form">
                <div className="review-form-head">
                  <Link href={href} className="review-form-subject">
                    <div className="market-card-avatar">
                      {cp.avatar ? <img src={cp.avatar} alt="" /> : <span>{initial}</span>}
                    </div>
                    <div>
                      <div className="review-form-subject-name">{cp.name ?? 'Пользователь'}</div>
                      <div className="review-form-subject-sub">
                        Оставь отзыв после работы
                      </div>
                    </div>
                  </Link>
                </div>
                <div className="review-form-stars">
                  <ReviewStars
                    value={draft.rating}
                    onChange={(v) =>
                      setDrafts((d) => ({ ...d, [cp.id]: { ...draft, rating: v } }))
                    }
                    size={22}
                  />
                </div>
                <textarea
                  className="form-textarea"
                  rows={3}
                  maxLength={800}
                  placeholder="Коротко: что понравилось, что можно улучшить."
                  value={draft.text}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [cp.id]: { ...draft, text: e.target.value } }))
                  }
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => submit(cp.id)}
                    disabled={busy === cp.id || draft.rating < 1}
                  >
                    {busy === cp.id ? 'Отправляем…' : 'Опубликовать отзыв'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Уже оставленные отзывы — все участники видят все */}
      {loading ? (
        <p style={{ color: 'var(--ink-mute)', fontSize: 13 }}>Загружаем отзывы…</p>
      ) : reviews.length === 0 ? (
        counterparties.length > 0 ? null : (
          <p style={{ color: 'var(--ink-mute)', fontSize: 13 }}>
            Отзывов пока нет.
          </p>
        )
      ) : (
        <div className="review-list">
          {reviews.map((r) => {
            const href = r.author_slug ? `/t/${r.author_slug}` : `/u/${r.author_id}`;
            const initial = (r.author_name ?? '?').trim().charAt(0).toUpperCase() || '?';
            return (
              <article key={r.id} className="review-card">
                <header className="review-card-head">
                  <Link href={href} className="review-card-author">
                    <div className="market-card-avatar">
                      {r.author_avatar ? <img src={r.author_avatar} alt="" /> : <span>{initial}</span>}
                    </div>
                    <div>
                      <div className="review-card-name">{r.author_name ?? 'Пользователь'}</div>
                      <div className="review-card-time">{timeAgo(r.created_at)}</div>
                    </div>
                  </Link>
                  <ReviewStars value={r.rating} size={16} />
                </header>
                {r.text && <p className="review-card-text">{r.text}</p>}
              </article>
            );
          })}
        </div>
      )}

      <ToastStack items={toasts} onDismiss={dismiss} />
    </section>
  );
}
