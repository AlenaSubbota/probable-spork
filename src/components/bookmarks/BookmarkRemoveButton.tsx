'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { useToasts, ToastStack } from '@/components/ui/Toast';

interface Props {
  firebaseId: string;
  /** Числовой PK новеллы — нужен для удаления tene-импортированных
      закладок, у которых ключ — id, а не firebase_id. */
  novelId?: number | null;
  title: string;
}

// Кнопка удаления новеллы из «Моя библиотека».
// profiles.bookmarks — это JSONB: может быть массивом firebase_id
// (legacy tene), массивом числовых id, объектом {firebase_id: status}
// или объектом {numeric_id: status} (тоже tene-наследие). Чистим
// все формы, удаляя любой ключ/элемент, который совпадает либо с
// firebaseId, либо со строкой числового PK.
//
// Запись идёт через RPC update_my_profile (SECURITY DEFINER) — direct
// UPDATE на profiles иногда не проходит RLS, и кнопка «корзина»
// тогда тихо ничего не делает.
export default function BookmarkRemoveButton({
  firebaseId,
  novelId,
  title,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { items: toasts, push, dismiss } = useToasts();

  const handleRemove = async () => {
    // confirm() используется намеренно — нативный диалог проще, чем
    // кастомный модалок, а действие потенциально потеряет прогресс
    // чтения. Для непросто-важных подтверждений нужен бы кастомный
    // ConfirmDialog, но «удалить из закладок» того не стоит.
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

    const numericKey = novelId != null ? String(novelId) : null;
    const matches = (key: string | number) => {
      const s = String(key);
      return s === firebaseId || (numericKey != null && s === numericKey);
    };

    let next: unknown = profile?.bookmarks;
    if (Array.isArray(next)) {
      next = (next as Array<string | number>).filter((id) => !matches(id));
    } else if (next && typeof next === 'object') {
      const copy = { ...(next as Record<string, unknown>) };
      for (const k of Object.keys(copy)) {
        if (matches(k)) delete copy[k];
      }
      next = copy;
    }

    // RPC из tene: позволяет self-update profiles в обход RLS,
    // плюс атомарно (без read-modify-write race).
    const { error } = await supabase.rpc('update_my_profile', {
      data_to_update: { bookmarks: next },
    });

    setBusy(false);
    if (error) {
      push('error', `Не получилось удалить: ${error.message}`);
      return;
    }
    router.refresh();
  };

  return (
    <>
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
      <ToastStack items={toasts} onDismiss={dismiss} />
    </>
  );
}
