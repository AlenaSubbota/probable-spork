'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import {
  ROLE_META,
  COMPENSATION_META,
  ALL_ROLES,
  ALL_COMPENSATIONS,
  type MarketplaceRole,
  type Compensation,
  type ListingStatus,
} from '@/lib/marketplace';
import { useToasts, ToastStack } from '@/components/ui/Toast';

export interface ListingFormInitial {
  id?: number;
  title?: string;
  description?: string;
  role?: MarketplaceRole;
  compensation?: Compensation;
  compensation_note?: string | null;
  novel_id?: number | null;
  status?: ListingStatus;
}

interface Props {
  mode: 'create' | 'edit';
  initial?: ListingFormInitial;
  myNovels: Array<{ id: number; firebase_id: string; title: string }>;
}

export default function ListingForm({ mode, initial, myNovels }: Props) {
  const router = useRouter();
  const { items: toasts, push: pushToast, dismiss } = useToasts();

  const [title, setTitle]             = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [role, setRole]               = useState<MarketplaceRole>(initial?.role ?? 'editor');
  const [compensation, setCompensation] = useState<Compensation>(
    initial?.compensation ?? 'revenue_share'
  );
  const [compNote, setCompNote]       = useState(initial?.compensation_note ?? '');
  const [novelId, setNovelId]         = useState<string>(
    initial?.novel_id ? String(initial.novel_id) : ''
  );
  const [status, setStatus]           = useState<ListingStatus>(initial?.status ?? 'open');
  const [busy, setBusy]               = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    const d = description.trim();
    if (t.length < 3) {
      pushToast('error', 'Название слишком короткое (≥3 символа).');
      return;
    }
    if (d.length < 10) {
      pushToast('error', 'Добавь описание — хотя бы пару предложений.');
      return;
    }
    setBusy(true);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      pushToast('error', 'Нужна авторизация.');
      setBusy(false);
      return;
    }

    const payload: Record<string, unknown> = {
      title: t,
      description: d,
      role,
      compensation,
      compensation_note: compNote.trim() || null,
      novel_id: novelId ? Number(novelId) : null,
    };

    if (mode === 'create') {
      payload.author_id = user.id;
      const { data, error } = await supabase
        .from('marketplace_listings')
        .insert(payload)
        .select('id')
        .single();
      setBusy(false);
      if (error || !data) {
        pushToast('error', `Не создалось: ${error?.message ?? 'ошибка'}`);
        return;
      }
      pushToast('success', 'Объявление опубликовано.');
      router.push(`/market/${data.id}`);
      router.refresh();
      return;
    }

    // edit
    payload.status = status;
    const { error } = await supabase
      .from('marketplace_listings')
      .update(payload)
      .eq('id', initial!.id!);
    setBusy(false);
    if (error) {
      pushToast('error', `Не сохранилось: ${error.message}`);
      return;
    }
    pushToast('success', 'Сохранено.');
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="admin-form">
      {mode === 'edit' && (
        <section className="settings-block">
          <h2>Статус</h2>
          <div className="filter-pills">
            {(['open', 'in_progress', 'closed'] as ListingStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                className={`filter-pill${status === s ? ' active' : ''}`}
                onClick={() => setStatus(s)}
              >
                {s === 'open' ? 'Открыто' : s === 'in_progress' ? 'В работе' : 'Закрыто'}
              </button>
            ))}
          </div>
          <div className="form-hint">
            Закрой, когда кого-то выбрал(а) или больше не актуально — чтобы не
            получать новые отклики.
          </div>
        </section>
      )}

      <section className="settings-block">
        <h2>Кого ищем</h2>
        <div className="market-role-grid">
          {ALL_ROLES.map((r) => (
            <button
              key={r}
              type="button"
              className={`market-role-tile${role === r ? ' active' : ''}`}
              onClick={() => setRole(r)}
            >
              <span className="market-role-tile-emoji" aria-hidden="true">
                {ROLE_META[r].emoji}
              </span>
              <span className="market-role-tile-label">{ROLE_META[r].label}</span>
              <span className="market-role-tile-desc">{ROLE_META[r].description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="settings-block">
        <h2>Описание</h2>
        <div className="form-field">
          <label>Заголовок</label>
          <input
            className="form-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="Например: Ищу корректора на корейский ромфант, 2 главы/нед"
          />
          <div className="form-hint">{title.length}/120</div>
        </div>

        <div className="form-field">
          <label>Подробности</label>
          <textarea
            className="form-textarea"
            rows={7}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={3000}
            placeholder={
              'Объём работы, сроки, стиль, специфика жанра. Что ждёшь — скорости или точности? Есть ли тестовая глава? Обязательные требования (например: опыт с корейским, китайские имена в BKRS).'
            }
          />
          <div className="form-hint">{description.length}/3000</div>
        </div>

        {myNovels.length > 0 && (
          <div className="form-field">
            <label>К какой новелле относится (необязательно)</label>
            <select
              className="form-input"
              value={novelId}
              onChange={(e) => setNovelId(e.target.value)}
              style={{ maxWidth: 420 }}
            >
              <option value="">— общее, без привязки —</option>
              {myNovels.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      <section className="settings-block">
        <h2>Условия</h2>
        <div className="filter-pills">
          {ALL_COMPENSATIONS.map((c) => (
            <button
              key={c}
              type="button"
              className={`filter-pill${compensation === c ? ' active' : ''}`}
              onClick={() => setCompensation(c)}
            >
              {COMPENSATION_META[c].label}
            </button>
          ))}
        </div>

        <div className="form-field" style={{ marginTop: 14 }}>
          <label>Конкретнее (необязательно)</label>
          <input
            className="form-input"
            value={compNote}
            onChange={(e) => setCompNote(e.target.value)}
            maxLength={300}
            placeholder="Например: «15% от доходов», «30 ₽ / глава», «упоминание в шапке»"
          />
          <div className="form-hint">{compNote.length}/300</div>
        </div>
      </section>

      <div className="admin-form-footer">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy
            ? 'Сохраняем…'
            : mode === 'create'
              ? 'Опубликовать'
              : 'Сохранить'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => router.back()}
          disabled={busy}
        >
          Отмена
        </button>
      </div>

      <ToastStack items={toasts} onDismiss={dismiss} />
    </form>
  );
}
