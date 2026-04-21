'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

interface Props {
  novelFirebaseId: string;
  initialStatus: string | null;     // null = не в закладках
}

const STATUSES = [
  { key: 'reading', label: 'Читаю' },
  { key: 'planned', label: 'В планах' },
  { key: 'paused',  label: 'На паузе' },
  { key: 'done',    label: 'Прочитано' },
  { key: 'dropped', label: 'Брошено' },
];

export default function BookmarkButton({ novelFirebaseId, initialStatus }: Props) {
  const router = useRouter();

  const handleToggle = async (nextStatus: string | null) => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Читаем текущие закладки
    const { data: profile } = await supabase
      .from('profiles')
      .select('bookmarks')
      .eq('id', user.id)
      .maybeSingle();

    // Приводим к формату { [firebase_id]: status }
    const raw = (profile as { bookmarks?: unknown } | null)?.bookmarks;
    let current: Record<string, string> = {};
    if (Array.isArray(raw)) {
      for (const id of raw as string[]) current[id] = 'reading';
    } else if (raw && typeof raw === 'object') {
      current = { ...(raw as Record<string, string>) };
    }

    if (nextStatus === null) {
      delete current[novelFirebaseId];
    } else {
      current[novelFirebaseId] = nextStatus;
    }

    await supabase.from('profiles').update({ bookmarks: current }).eq('id', user.id);
    router.refresh();
  };

  const currentLabel =
    STATUSES.find((s) => s.key === initialStatus)?.label ?? null;

  return (
    <div className="bookmark-btn-wrap">
      {initialStatus ? (
        <details className="bookmark-dropdown">
          <summary className="btn btn-ghost">
            ♥ {currentLabel ?? 'В полке'}
          </summary>
          <div className="bookmark-dropdown-menu">
            {STATUSES.map((s) => (
              <button
                key={s.key}
                type="button"
                className={`bookmark-dropdown-item${s.key === initialStatus ? ' active' : ''}`}
                onClick={() => handleToggle(s.key)}
              >
                {s.label}
              </button>
            ))}
            <button
              type="button"
              className="bookmark-dropdown-item danger"
              onClick={() => handleToggle(null)}
            >
              Убрать из полки
            </button>
          </div>
        </details>
      ) : (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => handleToggle('reading')}
        >
          ♡ В закладки
        </button>
      )}
    </div>
  );
}
