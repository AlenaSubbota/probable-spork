'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { timeAgo } from '@/lib/format';
import { APP_STATUS_META, type ApplicationStatus } from '@/lib/marketplace';
import { useToasts, ToastStack } from '@/components/ui/Toast';

interface Application {
  id: number;
  applicant_id: string;
  message: string | null;
  status: ApplicationStatus;
  portfolio_url: string | null;
  created_at: string;
  applicant_name: string | null;
  applicant_avatar: string | null;
  applicant_slug: string | null;
}

interface Props {
  applications: Application[];
  listingId: number;
  listingStatus: 'open' | 'in_progress' | 'closed';
  listingTitle: string;
  /** Для кнопки «Удалить» — разрешено автору и админу. */
  canDelete: boolean;
}

const STATUS_LABEL: Record<'open' | 'in_progress' | 'closed', string> = {
  open:        'открыто',
  in_progress: 'в работе',
  closed:      'закрыто',
};

// Панель управления откликами для автора объявления. Принимает/отклоняет,
// показывает карточку каждого заявителя. После «Принять» автор листинга
// получает контакт — UI даёт ссылку на профиль кандидата, дальше переписка
// в личке (у нас уже есть /messages).
export default function ApplicationsManager({
  applications,
  listingId,
  listingStatus,
  listingTitle,
  canDelete,
}: Props) {
  const router = useRouter();
  const { items: toasts, push: pushToast, dismiss } = useToasts();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  const updateStatus = async (appId: number, status: ApplicationStatus) => {
    setBusyId(appId);
    const supabase = createClient();
    const { error } = await supabase
      .from('marketplace_applications')
      .update({ status })
      .eq('id', appId);
    setBusyId(null);
    if (error) {
      pushToast('error', `Не получилось: ${error.message}`);
      return;
    }
    pushToast(
      'success',
      status === 'accepted'
        ? 'Принято. Свяжись с кандидатом в личке.'
        : status === 'declined'
          ? 'Отклонено.'
          : 'Статус обновлён.',
    );
    router.refresh();
  };

  const changeListingStatus = async (next: 'open' | 'in_progress' | 'closed') => {
    if (next === listingStatus) return;
    setStatusBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from('marketplace_listings')
      .update({ status: next })
      .eq('id', listingId);
    setStatusBusy(false);
    if (error) {
      pushToast('error', `Не получилось: ${error.message}`);
      return;
    }
    pushToast(
      'success',
      next === 'open'
        ? 'Объявление снова открыто.'
        : next === 'in_progress'
          ? 'Переведено в «В работе».'
          : 'Объявление закрыто.'
    );
    router.refresh();
  };

  const deleteListing = async () => {
    const confirmed = confirm(
      `Удалить объявление «${listingTitle}» навсегда?\n` +
        'Это необратимо. Отклики и отзывы тоже пропадут.'
    );
    if (!confirmed) return;
    setStatusBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from('marketplace_listings')
      .delete()
      .eq('id', listingId);
    setStatusBusy(false);
    if (error) {
      pushToast('error', `Не получилось удалить: ${error.message}`);
      return;
    }
    pushToast('success', 'Объявление удалено.');
    // После удаления ряд исчезает из marketplace_listings, возвращаем
    // пользователя в каталог — текущая страница даст 404 при refresh.
    setTimeout(() => router.push('/market'), 600);
  };

  const pending   = applications.filter((a) => a.status === 'pending');
  const accepted  = applications.filter((a) => a.status === 'accepted');
  const declined  = applications.filter((a) => a.status === 'declined');
  const withdrawn = applications.filter((a) => a.status === 'withdrawn');

  const ordered = [...pending, ...accepted, ...declined, ...withdrawn];

  return (
    <section className="applications-panel">
      <div className="section-head">
        <h2>Отклики</h2>
        <span className="more" style={{ cursor: 'default' }}>
          {applications.length}
          {pending.length > 0 && ` · ${pending.length} ждут`}
        </span>
      </div>

      <div className="applications-owner-tools">
        <div className="listing-status-current" aria-live="polite">
          Текущий статус:{' '}
          <strong className={`listing-status listing-status--${listingStatus}`}>
            {STATUS_LABEL[listingStatus]}
          </strong>
        </div>
        <div className="listing-status-actions">
          {listingStatus !== 'open' && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => changeListingStatus('open')}
              disabled={statusBusy}
              title="Открыть объявление снова — будут приниматься новые отклики"
            >
              🔓 Открыть снова
            </button>
          )}
          {listingStatus !== 'in_progress' && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => changeListingStatus('in_progress')}
              disabled={statusBusy}
            >
              📍 В работе
            </button>
          )}
          {listingStatus !== 'closed' && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => changeListingStatus('closed')}
              disabled={statusBusy}
            >
              🔒 Закрыть
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className="btn btn-ghost listing-btn-danger"
              onClick={deleteListing}
              disabled={statusBusy}
            >
              🗑 Удалить
            </button>
          )}
        </div>
      </div>

      {applications.length === 0 ? (
        <div className="empty-state" style={{ padding: 18 }}>
          <p>Откликов пока нет. Поделись ссылкой в своих каналах — читатели
            редко сами натыкаются на маркетплейс.</p>
        </div>
      ) : (
        <div className="applications-list">
          {ordered.map((a) => {
            const initial = (a.applicant_name ?? '?').trim().charAt(0).toUpperCase() || '?';
            const href = a.applicant_slug
              ? `/t/${a.applicant_slug}`
              : `/u/${a.applicant_id}`;
            return (
              <article key={a.id} className="application-card">
                <header className="application-card-head">
                  <Link href={href} className="application-card-author">
                    <div className="market-card-avatar">
                      {a.applicant_avatar ? (
                        <img src={a.applicant_avatar} alt="" />
                      ) : (
                        <span>{initial}</span>
                      )}
                    </div>
                    <div>
                      <div className="application-card-name">
                        {a.applicant_name ?? 'Читатель'}
                      </div>
                      <div className="application-card-time">
                        {timeAgo(a.created_at)}
                      </div>
                    </div>
                  </Link>
                  <span className={`app-status ${APP_STATUS_META[a.status].className}`}>
                    {APP_STATUS_META[a.status].label}
                  </span>
                </header>

                {a.message && (
                  <p className="application-card-message">{a.message}</p>
                )}

                {a.portfolio_url && (
                  <div className="application-card-portfolio">
                    <span>📎 Портфолио:</span>{' '}
                    <a
                      href={a.portfolio_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="more"
                    >
                      {a.portfolio_url}
                    </a>
                  </div>
                )}

                {a.status === 'pending' && (
                  <div className="application-card-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => updateStatus(a.id, 'accepted')}
                      disabled={busyId === a.id}
                    >
                      ✓ Принять
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => updateStatus(a.id, 'declined')}
                      disabled={busyId === a.id}
                    >
                      Отклонить
                    </button>
                    <Link
                      href={`/messages/${a.applicant_id}`}
                      className="btn btn-ghost"
                    >
                      💬 Написать
                    </Link>
                  </div>
                )}

                {a.status === 'accepted' && (
                  <div className="application-card-actions">
                    <Link
                      href={`/messages/${a.applicant_id}`}
                      className="btn btn-primary"
                    >
                      💬 Перейти в чат
                    </Link>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <ToastStack items={toasts} onDismiss={dismiss} />
    </section>
  );
}
