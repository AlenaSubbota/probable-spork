'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

interface Props {
  collectionId: number;
  initialFeatured: boolean;
  /** Подборку нельзя закрепить, пока она не опубликована. */
  isPublished: boolean;
}

// Тоггл «закрепить на главной» для админ-страницы /admin/collections.
// Прямой UPDATE в `collections.is_featured` — RLS-политика
// collections_update_admin разрешает админу. Триггер защиты от
// переводчиков на этот UPDATE не реагирует, потому что владелец
// — админ. Перерисовываем серверной refresh().
export default function FeatureToggle({
  collectionId,
  initialFeatured,
  isPublished,
}: Props) {
  const [featured, setFeatured] = useState(initialFeatured);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const toggle = async () => {
    if (!isPublished && !featured) {
      setError('Сначала опубликуй подборку — закрепить можно только её.');
      return;
    }
    setError(null);
    const next = !featured;
    setFeatured(next); // оптимистично
    const supabase = createClient();
    const { error: updErr } = await supabase
      .from('collections')
      .update({ is_featured: next })
      .eq('id', collectionId);
    if (updErr) {
      setFeatured(!next); // откат
      setError(updErr.message);
      return;
    }
    startTransition(() => router.refresh());
  };

  return (
    <div className="admin-collections-feature">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={`admin-collections-feature-btn${featured ? ' is-on' : ''}`}
        title={
          featured
            ? 'Снять с главной'
            : isPublished
            ? 'Закрепить на главной'
            : 'Подборка ещё не опубликована'
        }
      >
        <span className="admin-collections-feature-star" aria-hidden="true">
          {featured ? '★' : '☆'}
        </span>
        {featured ? 'На главной' : 'Закрепить'}
      </button>
      {error && <span className="admin-collections-feature-error">{error}</span>}
    </div>
  );
}
