'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { useToasts, ToastStack } from '@/components/ui/Toast';

interface MyNovel {
  id: number;
  title: string;
  firebase_id: string;
  team_id: number | null;
}

interface TeamNovel {
  id: number;
  title: string;
  firebase_id: string;
  translator_id: string | null;
}

interface Props {
  teamId: number;
  myNovels: MyNovel[];
  teamNovels: TeamNovel[];
  currentUserId: string;
}

export default function TeamNovelsLinker({
  teamId,
  myNovels,
  teamNovels,
  currentUserId,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const { items: toasts, push, dismiss } = useToasts();
  const [busyId, setBusyId] = useState<number | null>(null);

  // Мои новеллы, которые ещё НЕ привязаны ни к какой команде или привязаны
  // не к этой — кандидаты на привязку.
  const candidates = myNovels.filter((n) => n.team_id !== teamId);
  // teamNovels могут включать новеллы, заведённые ДРУГИМИ переводчиками
  // (если админ их прикреплял). Не даём им быть отвязанными «не своими».
  const linked = teamNovels;

  const link = async (novelId: number) => {
    setBusyId(novelId);
    const { error } = await supabase
      .from('novels')
      .update({ team_id: teamId })
      .eq('id', novelId);
    setBusyId(null);
    if (error) {
      push('error', error.message);
      return;
    }
    push('success', 'Прикреплено.');
    router.refresh();
  };

  const unlink = async (novelId: number, ownerId: string | null) => {
    if (ownerId !== currentUserId) {
      push('error', 'Эту новеллу прикрепил другой переводчик — попроси его открепить.');
      return;
    }
    setBusyId(novelId);
    const { error } = await supabase
      .from('novels')
      .update({ team_id: null })
      .eq('id', novelId);
    setBusyId(null);
    if (error) {
      push('error', error.message);
      return;
    }
    push('success', 'Откреплено.');
    router.refresh();
  };

  return (
    <section className="settings-block team-novels-linker">
      <h2>Новеллы команды</h2>
      <p className="form-hint" style={{ marginTop: -6, marginBottom: 14 }}>
        Прикрепи свои новеллы к команде — на их карточках читатели
        увидят «перевод команды …» вместо одиночного переводчика.
      </p>

      {linked.length > 0 ? (
        <div className="team-novels-list">
          {linked.map((n) => {
            const ownsThis = n.translator_id === currentUserId;
            return (
              <div key={n.id} className="team-novels-row">
                <Link
                  href={`/novel/${n.firebase_id}`}
                  className="team-novels-row-title"
                >
                  📘 {n.title}
                </Link>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => unlink(n.id, n.translator_id)}
                  disabled={busyId === n.id || !ownsThis}
                  style={{ height: 30, fontSize: 12 }}
                  title={
                    ownsThis
                      ? 'Открепить от команды'
                      : 'Эту новеллу прикрепил другой автор'
                  }
                >
                  Открепить
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state" style={{ padding: 14, textAlign: 'left' }}>
          <p style={{ margin: 0 }}>
            Пока ни одна новелла не прикреплена к команде. Прикрепи из
            списка ниже — или создай новую и не забудь её сюда привязать.
          </p>
        </div>
      )}

      {candidates.length > 0 && (
        <div className="team-novels-candidates">
          <h3 className="team-novels-candidates-title">Мои новеллы</h3>
          <div className="team-novels-candidates-list">
            {candidates.map((n) => (
              <div key={n.id} className="team-novels-row team-novels-row--candidate">
                <span className="team-novels-row-title">📘 {n.title}</span>
                {n.team_id ? (
                  <span className="team-novels-row-pill">в другой команде</span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => link(n.id)}
                    disabled={busyId === n.id}
                    style={{ height: 30, fontSize: 12 }}
                  >
                    Прикрепить
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <ToastStack items={toasts} onDismiss={dismiss} />
    </section>
  );
}
