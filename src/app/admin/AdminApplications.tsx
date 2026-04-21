'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

interface Application {
  id: number;
  user_id: string;
  motivation: string;
  portfolio_url: string | null;
  desired_slug: string | null;
  languages: string[] | null;
  status: string;
  created_at: string;
}

interface Props {
  applications: Application[];
}

const LANG_LABELS: Record<string, string> = {
  kr: 'KR',
  cn: 'CN',
  jp: 'JP',
  en: 'EN',
};

export default function AdminApplications({ applications }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);

  const handleAction = async (id: number, action: 'approve' | 'reject') => {
    const note = window.prompt(
      action === 'approve'
        ? 'Комментарий для переводчика (необязательно):'
        : 'Причина отказа (необязательно):'
    );
    if (note === null) return; // отмена

    setBusy(id);
    const supabase = createClient();
    const rpc =
      action === 'approve'
        ? 'approve_translator_application'
        : 'reject_translator_application';
    const { error } = await supabase.rpc(rpc, {
      p_application_id: id,
      p_note: note || null,
    });
    if (error) {
      alert(`Ошибка: ${error.message}`);
    } else {
      router.refresh();
    }
    setBusy(null);
  };

  if (applications.length === 0) {
    return (
      <section>
        <div className="section-head">
          <h2>Заявки в переводчики</h2>
        </div>
        <div className="empty-state">
          <p>Новых заявок нет.</p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="section-head">
        <h2>Заявки в переводчики</h2>
        <span className="more" style={{ cursor: 'default' }}>
          {applications.length} ожидают
        </span>
      </div>

      <div className="application-list">
        {applications.map((a) => (
          <div key={a.id} className="application-row">
            <div className="application-body">
              <div className="application-meta">
                {new Date(a.created_at).toLocaleDateString('ru-RU')}
                {a.desired_slug && <> · slug: <code>{a.desired_slug}</code></>}
                {a.languages && a.languages.length > 0 && (
                  <> · {a.languages.map((l) => LANG_LABELS[l] ?? l).join(', ')}</>
                )}
              </div>
              <div className="application-motivation">{a.motivation}</div>
              {a.portfolio_url && (
                <a
                  href={a.portfolio_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: 'var(--accent)', fontSize: 13 }}
                >
                  Портфолио →
                </a>
              )}
            </div>
            <div className="application-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleAction(a.id, 'approve')}
                disabled={busy === a.id}
              >
                Одобрить
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => handleAction(a.id, 'reject')}
                disabled={busy === a.id}
              >
                Отклонить
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
