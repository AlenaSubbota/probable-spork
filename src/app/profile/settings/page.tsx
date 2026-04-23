import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import SettingsForm from './SettingsForm';
import LinkedAccounts from './LinkedAccounts';
import RoadmapEditor from './RoadmapEditor';
import PaymentMethodsEditor from './PaymentMethodsEditor';

export const metadata = { title: 'Настройки — Chaptify' };

export default async function ProfileSettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profileRaw } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  const profile = (profileRaw ?? {}) as {
    user_name?: string | null;
    email?: string | null;
    telegram_id?: number | null;
    role?: string;
    is_admin?: boolean;
    avatar_url?: string | null;
    translator_display_name?: string | null;
    translator_avatar_url?: string | null;
    translator_about?: string | null;
    payout_boosty_url?: string | null;
    settings?: Record<string, unknown> | null;
    quiet_until?: string | null;
    quiet_note?: string | null;
    chaptify_bot_chat_id?: number | null;
    accepts_coins_for_chapters?: boolean | null;
  };

  const isTranslator =
    profile.is_admin === true ||
    profile.role === 'translator' ||
    profile.role === 'admin';

  // Фото из user_metadata. Провайдер определяем по app_metadata.provider
  // или по identities (первый linked аккаунт). Raw поле photo_url — это
  // Telegram-виджет (наш auth-service туда кладёт), avatar_url — Google
  // / Yandex OAuth (Supabase стандарт).
  const meta = (user.user_metadata ?? {}) as {
    photo_url?: string;
    avatar_url?: string;
    picture?: string;
  };
  const externalPhotoUrl =
    meta.photo_url ?? meta.avatar_url ?? meta.picture ?? null;

  const appMeta = (user.app_metadata ?? {}) as { provider?: string };
  const providerRaw = (appMeta.provider ?? '').toLowerCase();
  const externalProvider: 'google' | 'telegram' | 'yandex' | 'other' | null =
    externalPhotoUrl
      ? providerRaw === 'google'
        ? 'google'
        : providerRaw === 'telegram' || meta.photo_url
          ? 'telegram'
          : providerRaw === 'yandex'
            ? 'yandex'
            : 'other'
      : null;

  return (
    <main className="container section" style={{ maxWidth: 760 }}>
      <div className="admin-breadcrumbs">
        <Link href="/profile">Профиль</Link>
        <span>/</span>
        <span>Настройки</span>
      </div>

      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-serif)', margin: '0 0 6px' }}>
          Настройки профиля
        </h1>
        <p style={{ color: 'var(--ink-mute)', margin: 0 }}>
          Как тебя видят другие и насколько открыт твой профиль.
        </p>
      </header>

      <SettingsForm
        userId={user.id}
        isTranslator={isTranslator}
        externalPhotoUrl={externalPhotoUrl}
        externalProvider={externalProvider}
        initial={{
          user_name: profile.user_name ?? '',
          email: profile.email ?? null,
          telegram_id: profile.telegram_id ?? null,
          avatar_url: profile.avatar_url ?? null,
          translator_display_name: profile.translator_display_name ?? '',
          translator_avatar_url: profile.translator_avatar_url ?? null,
          translator_about: profile.translator_about ?? '',
          payout_boosty_url: profile.payout_boosty_url ?? '',
          show_reading_publicly:
            (profile.settings as { show_reading_publicly?: boolean } | null)
              ?.show_reading_publicly ?? true,
          quiet_until: profile.quiet_until
            ? profile.quiet_until.slice(0, 10)  // yyyy-MM-dd для <input type="date">
            : '',
          quiet_note: profile.quiet_note ?? '',
          accepts_coins_for_chapters:
            profile.accepts_coins_for_chapters ?? true,
        }}
      />

      <LinkedAccounts
        telegramId={profile.telegram_id ?? null}
        hasChaptifyBot={profile.chaptify_bot_chat_id != null}
      />

      {isTranslator && <PaymentMethodsEditor translatorId={user.id} />}

      {isTranslator && <RoadmapEditor translatorId={user.id} />}
    </main>
  );
}
