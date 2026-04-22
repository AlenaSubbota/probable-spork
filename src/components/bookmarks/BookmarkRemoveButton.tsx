'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

interface Props {
  firebaseId: string;
  title: string;
}

// Кнопка удаления новеллы из «Моя библиотека».
// profiles.bookmarks — это JSONB: может быть массивом firebase_id (legacy tene)
// или объектом {firebase_id: status}. Чтобы не ломать tene, поддерживаем оба
// формата: читаем текущее значение, удаляем ключ/элемент, пишем обратно.
export default function BookmarkRemoveButton({ firebaseId, title }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const handleRemove = async () => {
    if (!confirm(`Убрать «${title}» из библиотеки?`)) return;
    setBusy(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('bookmarks')
      .eq('id', user.id)
      .maybeSingle();

    let next: unknown = profile?.bookmarks;
    if (Array.isArray(next)) {
      next = (next as string[]).filter((id) => id !== firebaseId);
    } else if (next && typeof next === 'object') {
      const copy = { ...(next as Record<string, unknown>) };
      delete copy[firebaseId];
      next = copy;
    }

    const { error } = await supabase
      .from('profiles')
      .update({ bookmarks: next })
      .eq('id', user.id);

    setBusy(false);
    if (error) {
      alert(`Не получилось удалить: ${error.message}`);
      return;
    }
    router.refresh();
  };

  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={handleRemove}
      disabled={busy}
      title="Убрать из библиотеки"
      aria-label="Убрать из библиотеки"
      style={{ height: 34, width: 38, padding: 0, fontSize: 14 }}
    >
      {busy ? '…' : '🗑'}
    </button>
  );
}
