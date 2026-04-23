'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import AvatarPicker from '@/components/AvatarPicker';
import { useToasts, ToastStack } from '@/components/ui/Toast';

interface SettingsValues {
  user_name: string;
  email: string | null;
  telegram_id: number | null;
  avatar_url: string | null;
  translator_display_name: string;
  translator_avatar_url: string | null;
  translator_about: string;
  payout_boosty_url: string;
  show_reading_publicly: boolean;
  quiet_until: string;
  quiet_note: string;
  accepts_coins_for_chapters: boolean;
}

interface Props {
  userId: string;
  isTranslator: boolean;
  telegramPhotoUrl: string | null;
  initial: SettingsValues;
}

export default function SettingsForm({
  userId,
  isTranslator,
  telegramPhotoUrl,
  initial,
}: Props) {
  const router = useRouter();
  const [values, setValues] = useState<SettingsValues>(initial);
  const [submitting, setSubmitting] = useState(false);
  const { items: toasts, push, dismiss } = useToasts();

  const set = <K extends keyof SettingsValues>(k: K, v: SettingsValues[K]) =>
    setValues((p) => ({ ...p, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);

    const supabase = createClient();

    const payload: Record<string, unknown> = {
      user_name: values.user_name.trim() || null,
      avatar_url: values.avatar_url,
    };
    if (isTranslator) {
      payload.translator_display_name = values.translator_display_name.trim() || null;
      payload.translator_avatar_url = values.translator_avatar_url;
      payload.translator_about = values.translator_about.trim() || null;
      payload.payout_boosty_url = values.payout_boosty_url.trim() || null;

      // Тихий режим: дата в input === yyyy-MM-dd. Переводим в timestamptz
      // «конец указанного дня» — так баннер исчезнет наутро после даты.
      const quietRaw = values.quiet_until.trim();
      payload.quiet_until = quietRaw ? `${quietRaw}T23:59:59Z` : null;
      payload.quiet_note = values.quiet_note.trim() || null;
      payload.accepts_coins_for_chapters = values.accepts_coins_for_chapters;
    }
    // Приватность хранится в profiles.settings jsonb
    payload.settings = {
      show_reading_publicly: values.show_reading_publicly,
    };

    const { error } = await supabase.rpc('update_my_settings', {
      data_to_update: payload,
    });

    setSubmitting(false);
    if (error) {
      push('error', `Не сохранилось: ${error.message}`);
    } else {
      push('success', 'Сохранено — изменения применены');
      router.refresh();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="admin-form">
      {/* Аватар */}
      <section className="settings-block">
        <h2>Аватар</h2>
        <AvatarPicker
          userId={userId}
          name={values.user_name || 'U'}
          telegramPhotoUrl={telegramPhotoUrl}
          value={values.avatar_url}
          onChange={(v) => set('avatar_url', v)}
        />
      </section>

      {/* Имя и контакты */}
      <section className="settings-block">
        <h2>Имя и контакты</h2>
        <div className="form-field">
          <label title="Имя, которое видно в комментариях, профиле, сообщениях.">
            Отображаемое имя
          </label>
          <input
            className="form-input"
            value={values.user_name}
            onChange={(e) => set('user_name', e.target.value)}
            maxLength={60}
            placeholder="Как тебя называть"
          />
        </div>

        {values.email && (
          <div className="form-field">
            <label>Email</label>
            <input
              className="form-input"
              value={values.email}
              disabled
              style={{ opacity: 0.6 }}
            />
            <div className="form-hint">Email меняется через /login и magic link. Пиши в поддержку.</div>
          </div>
        )}

        {values.telegram_id && (
          <div className="form-field">
            <label>Telegram</label>
            <input
              className="form-input"
              value={`id: ${values.telegram_id}`}
              disabled
              style={{ opacity: 0.6 }}
            />
            <div className="form-hint">Привязка к Telegram управляется через @tenebrisverbot.</div>
          </div>
        )}
      </section>

      {/* Приватность */}
      <section className="settings-block">
        <h2>Приватность</h2>
        <label className="rs-switch" style={{ height: 'auto', padding: 14 }}>
          <input
            type="checkbox"
            checked={values.show_reading_publicly}
            onChange={(e) => set('show_reading_publicly', e.target.checked)}
          />
          <div>
            <div className="rs-switch-title">Показывать мою историю чтения другим</div>
            <div className="rs-switch-sub">
              Если выключено — друзья и другие пользователи не увидят что ты сейчас читаешь,
              сколько новелл открыл_а, стрик и диету. Комментарии и цитаты под спойлером всё
              равно остаются публичными.
            </div>
          </div>
        </label>
      </section>

      {/* Блок переводчика */}
      {isTranslator && (
        <section className="settings-block">
          <h2>Страница переводчика</h2>
          <p style={{ color: 'var(--ink-mute)', fontSize: 13.5, marginTop: -8, marginBottom: 14 }}>
            Это видно на твоей публичной странице <code>/t/slug</code>.
          </p>

          <div className="form-field">
            <label title="Красивое имя — как подписываешься как переводчик. Можно отличаться от обычного.">
              Переводческий псевдоним
            </label>
            <input
              className="form-input"
              value={values.translator_display_name}
              onChange={(e) => set('translator_display_name', e.target.value)}
              maxLength={80}
              placeholder="Например: Алёна Субботина"
            />
          </div>

          <div className="form-field">
            <label title="Отдельный аватар для публичной страницы переводчика (можно тот же, что и личный).">
              Аватар для публичной страницы
            </label>
            <AvatarPicker
              userId={userId}
              name={values.translator_display_name || values.user_name || 'T'}
              telegramPhotoUrl={telegramPhotoUrl}
              value={values.translator_avatar_url}
              onChange={(v) => set('translator_avatar_url', v)}
            />
          </div>

          <div className="form-field">
            <label title="Пара абзацев о себе: что переводишь, что любишь, как связаться.">
              О себе
            </label>
            <textarea
              className="form-textarea"
              rows={4}
              value={values.translator_about}
              onChange={(e) => set('translator_about', e.target.value)}
              maxLength={600}
              placeholder="Привет, я перевожу ромфэнтези и слайсы на русский. Открыта к коллаборациям."
            />
          </div>

          <div className="form-field">
            <label>Ссылка на Boosty</label>
            <input
              type="url"
              className="form-input"
              value={values.payout_boosty_url}
              onChange={(e) => set('payout_boosty_url', e.target.value)}
              placeholder="https://boosty.to/alenasubbota"
            />
            <div className="form-hint">
              Настройки Tribute webhook — на странице{' '}
              <a href="/admin/payouts" className="more">/admin/payouts</a>.
            </div>
          </div>
        </section>
      )}

      {isTranslator && (
        <section className="settings-block">
          <h2>Монеты за главы</h2>
          <p style={{ color: 'var(--ink-mute)', fontSize: 13.5, marginTop: -8, marginBottom: 14 }}>
            Если выключишь — читатели смогут открывать твои платные главы
            только через внешнюю подписку (Boosty / Tribute / VK Donut), а
            не за внутренние монеты chaptify. Чаевые монетами после главы
            работают всегда.
          </p>
          <label className="rs-switch" style={{ height: 'auto', padding: 14 }}>
            <input
              type="checkbox"
              checked={values.accepts_coins_for_chapters}
              onChange={(e) =>
                set('accepts_coins_for_chapters', e.target.checked)
              }
            />
            <div>
              <div className="rs-switch-title">Принимать оплату монетами за платные главы</div>
              <div className="rs-switch-sub">
                {values.accepts_coins_for_chapters
                  ? 'Включено: читатели могут купить главу за монеты.'
                  : 'Выключено: читатели увидят только внешние подписки.'}
              </div>
            </div>
          </label>
        </section>
      )}

      {isTranslator && (
        <section className="settings-block">
          <h2>Тихий режим</h2>
          <p style={{ color: 'var(--ink-mute)', fontSize: 13.5, marginTop: -8, marginBottom: 14 }}>
            Иногда нужен отдых. Поставь дату — до неё на твоей публичной
            странице появится уважительный баннер вместо «давно не было глав».
            Можно добавить пару слов — что происходит и когда ждать.
          </p>

          <div className="form-field">
            <label>Восстанавливаюсь до</label>
            <input
              type="date"
              className="form-input"
              value={values.quiet_until}
              onChange={(e) => set('quiet_until', e.target.value)}
              style={{ maxWidth: 220 }}
            />
            <div className="form-hint">
              Оставь пустым, чтобы выключить режим. Дата — последний день паузы;
              со следующего утра баннер пропадает.
            </div>
          </div>

          <div className="form-field">
            <label>Личная пометка (необязательно)</label>
            <textarea
              className="form-textarea"
              rows={2}
              maxLength={300}
              value={values.quiet_note}
              onChange={(e) => set('quiet_note', e.target.value)}
              placeholder="Например: «болею, вернусь на следующей неделе»"
            />
            <div className="form-hint">{values.quiet_note.length}/300</div>
          </div>
        </section>
      )}

      <div className="admin-form-footer">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Сохраняем…' : 'Сохранить'}
        </button>
        <ToastStack items={toasts} onDismiss={dismiss} />
      </div>
    </form>
  );
}
