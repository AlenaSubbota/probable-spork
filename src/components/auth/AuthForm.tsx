'use client';

import { useEffect, useState } from 'react';
// Убрали useRouter — логин завершается через window.location.href = '/',
// чтобы SSR-запрос увидел свежие cookies из setSession().
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import TelegramLoginWidget from './TelegramLoginWidget';
import MigrationHint from './MigrationHint';

interface Props {
  mode: 'login' | 'register';
}

const BOT_USERNAME = process.env.NEXT_PUBLIC_TG_BOT_USERNAME || 'tenebrisverbot';
// Trust-root для Telegram-входа теперь живёт в server route /auth/tg —
// он проксирует подписанный widget-payload на auth-service-chaptify
// (NEXT_PUBLIC_AUTH_API_URL) и ставит cookies. Виджету достаточно
// абсолютного authUrl на наш домен.

export default function AuthForm({ mode }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'busy' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatus('busy');
    const supabase = createClient();

    try {
      if (mode === 'register') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/` },
        });
        if (error) throw error;
        // Hard reload, чтобы SSR-шапка увидела новые cookies и юзера
        window.location.href = '/';
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        window.location.href = '/';
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
      setStatus('error');
    }
  };

  const handleGoogleAuth = async () => {
    setError(null);
    const supabase = createClient();
    // redirectTo ведёт на наш callback-route, где code обменяется на
    // session и cookie ляжет на домене chaptify.ru — только после этого
    // SSR-шапка увидит юзера. Ставить сюда '/' нельзя: там нет кода
    // для exchangeCodeForSession().
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setError(error.message);
  };

  const handleYandexAuth = () => {
    // Yandex не поддерживается Supabase нативно — флоу проксируется
    // через auth-service-chaptify (POST /auth/yandex). Server-route
    // /auth/yandex редиректит на oauth.yandex.ru, callback обменивает
    // code на supabase-session, finalize пишет cookies на клиенте.
    setError(null);
    window.location.href = '/auth/yandex';
  };

  // authUrl для Telegram-виджета считаем на клиенте (window.location.origin)
  // и только после монтирования. Telegram требует абсолютный URL; на этапе
  // SSR origin неизвестен, на клиенте — сейчас нужный (chaptify.ru / dev /
  // прев/штол).
  const [tgAuthUrl, setTgAuthUrl] = useState<string | null>(null);
  useEffect(() => {
    setTgAuthUrl(`${window.location.origin}/auth/tg`);
  }, []);

  // Если на /login пришли с ?error=oauth_failed | tg_* | yandex_*, покажем
  // дружелюбный текст один раз на маунте (не оверрайдим юзерские формы).
  useEffect(() => {
    const url = new URL(window.location.href);
    const reason = url.searchParams.get('error');
    if (!reason) return;
    const messages: Record<string, string> = {
      oauth_failed: 'Не удалось войти через провайдера. Попробуй ещё раз.',
      tg_widget_invalid: 'Telegram прислал неполные данные. Попробуй ещё раз.',
      tg_not_configured: 'Telegram-вход не настроен на сервере. Сообщи администратору.',
      tg_auth_failed: 'Telegram-подпись не прошла валидацию. Попробуй ещё раз.',
      tg_network: 'Не получилось связаться с auth-сервисом. Проверь интернет.',
      tg_no_session: 'Auth-сервис не вернул сессию. Сообщи администратору.',
      yandex_user_denied: 'Вход через Яндекс отменён.',
      yandex_widget_invalid: 'Яндекс прислал неполные данные. Попробуй ещё раз.',
      yandex_state_mismatch: 'Сессия входа через Яндекс устарела. Попробуй ещё раз.',
      yandex_not_configured: 'Вход через Яндекс не настроен на сервере. Сообщи администратору.',
      yandex_auth_failed: 'Яндекс не подтвердил вход. Попробуй ещё раз.',
      yandex_network: 'Не получилось связаться с auth-сервисом. Проверь интернет.',
      yandex_no_session: 'Auth-сервис не вернул сессию. Сообщи администратору.',
      yandex_handoff_missing: 'Токены входа потерялись. Попробуй ещё раз.',
      yandex_setsession_failed: 'Не удалось установить сессию. Попробуй ещё раз.',
    };
    setError(messages[reason] ?? 'Ошибка входа.');
  }, []);

  const isRegister = mode === 'register';

  return (
    <div className="auth-card">
      <div className="auth-card-head">
        <h1>{isRegister ? 'Создать аккаунт' : 'С возвращением'}</h1>
        <p className="auth-card-sub">
          {isRegister
            ? 'Выбери любой способ входа — всё бесплатно и без анкет.'
            : 'Выбери способ, которым ты уже регистрировался_ась.'}
        </p>
      </div>

      {/* Киллер-фича #2: подсказка о переезде */}
      <MigrationHint />

      {/* Киллер-фича #1: Telegram в один клик */}
      <div className="auth-section">
        <div className="auth-section-label">
          Быстрый вход через Telegram
        </div>
        <div className="auth-tg-widget">
          {tgAuthUrl && (
            <TelegramLoginWidget botName={BOT_USERNAME} authUrl={tgAuthUrl} />
          )}
        </div>
        <p className="auth-hint">
          Клик → выбираешь аккаунт → готово. Без паролей.
        </p>
      </div>

      <div className="auth-divider"><span>или</span></div>

      {/* OAuth-провайдеры */}
      <div className="auth-oauth-row">
        <button
          type="button"
          className="auth-oauth-btn"
          onClick={handleGoogleAuth}
          disabled={status === 'busy'}
        >
          <GoogleIcon />
          <span>Google</span>
        </button>
        <button
          type="button"
          className="auth-oauth-btn"
          onClick={handleYandexAuth}
          disabled={status === 'busy'}
        >
          <YandexIcon />
          <span>Яндекс</span>
        </button>
      </div>

      <div className="auth-divider"><span>или</span></div>

      {/* Email-форма. Magic-link пока выключен: шаблон письма общий с
          tene.fun на одной Supabase, поэтому юзер получает «добро
          пожаловать в tene». Вернём когда разделим Site URL per-site. */}
      <div className="auth-section-label" style={{ marginTop: 8 }}>
        {isRegister ? 'Регистрация по email' : 'Вход по паролю'}
      </div>

      {false ? (
        <div className="auth-success" />
      ) : (
        <form onSubmit={handleEmailSubmit} className="auth-email-form">
          <input
            type="email"
            className="form-input"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            className="form-input"
            placeholder={isRegister ? 'Придумай пароль' : 'Пароль'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={status === 'busy'}
            style={{ width: '100%' }}
          >
            {status === 'busy'
              ? 'Ждите…'
              : isRegister
              ? 'Создать аккаунт'
              : 'Войти'}
          </button>
        </form>
      )}

      {error && <div className="auth-error">{error}</div>}

      <div className="auth-footer">
        {isRegister ? (
          <>
            Уже есть аккаунт?{' '}
            <Link href="/login" className="more">
              Войти
            </Link>
          </>
        ) : (
          <>
            Ещё нет аккаунта?{' '}
            <Link href="/register" className="more">
              Создать
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}

function YandexIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="4" fill="#FC3F1D" />
      <path fill="#fff" d="M13.49 18.3h-1.62V8.52h-.38L7.85 18.3H5.91l3.98-9.5c-1.17-.38-2.24-1.2-2.24-3 0-2.24 1.5-3.4 3.65-3.4h3.2V18.3h-.01z" />
    </svg>
  );
}
