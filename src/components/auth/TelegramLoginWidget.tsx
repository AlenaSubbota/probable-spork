'use client';

import { useEffect, useRef } from 'react';

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

interface BaseProps {
  botName: string;
}

interface AuthUrlProps extends BaseProps {
  /**
   * Абсолютный URL обработчика подписанных данных от Telegram (data-auth-url).
   * Например: https://chaptify.ru/auth/tg
   *
   * Используется для логина / регистрации: Telegram редиректит браузер
   * сюда (popup или full-page — в зависимости от среды). Серверный
   * route ставит auth-cookies. Это единственный режим, который
   * нормально работает в in-app браузере Telegram.
   *
   * Telegram требует ОБЯЗАТЕЛЬНО абсолютный URL (https://...).
   * Относительные пути виджет молча игнорирует.
   */
  authUrl: string;
  onAuth?: never;
}

interface OnAuthProps extends BaseProps {
  /**
   * JS-callback (data-onauth). Используется только в linking-flow
   * на /profile/settings, где запрос требует существующий
   * Authorization-header с access_token текущего юзера и сделать
   * это в server-side redirect не получается без отдельного route.
   *
   * ВАЖНО: этот режим использует postMessage между попапом и opener'ом,
   * который часто НЕ работает в in-app браузере Telegram. Не использовать
   * для основного логина.
   */
  onAuth: (user: TelegramUser) => void;
  authUrl?: never;
}

type Props = AuthUrlProps | OnAuthProps;

// Telegram Login Widget. Два режима — см. JSDoc у Props.
//
// Виджет работает только если домен зарегистрирован у бота через
// BotFather → /setdomain (chaptify.ru → @chaptifybot).

export default function TelegramLoginWidget(props: Props) {
  const { botName } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  // onAuth держим в ref, чтобы пересоздание callback'а в родителе не
  // вызывало переинициализацию виджета (тот не умеет hot-replace атрибутов).
  const onAuthRef = useRef<typeof props.onAuth>(props.onAuth);

  useEffect(() => {
    onAuthRef.current = props.onAuth;
  }, [props.onAuth]);

  // Берём примитивные значения как зависимости, чтобы не пересоздавать
  // виджет при каждом ре-рендере родителя.
  const authUrl = 'authUrl' in props ? props.authUrl : undefined;
  const hasOnAuth = 'onAuth' in props && !!props.onAuth;

  useEffect(() => {
    if (containerRef.current?.querySelector('script')) return;

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', botName);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '10');
    script.setAttribute('data-request-access', 'write');
    script.setAttribute('data-userpic', 'false');

    if (authUrl) {
      script.setAttribute('data-auth-url', authUrl);
    } else if (hasOnAuth) {
      const cbName = '__chaptifyTgAuth';
      (window as unknown as Record<string, unknown>)[cbName] = (u: TelegramUser) => {
        onAuthRef.current?.(u);
      };
      script.setAttribute('data-onauth', `${cbName}(user)`);
    }

    script.async = true;

    if (containerRef.current) {
      containerRef.current.innerHTML = '';
      containerRef.current.appendChild(script);
    }

    return () => {
      // Чистим глобальный коллбэк, чтобы при unmount/remount не утекал.
      if (hasOnAuth) {
        (window as unknown as Record<string, unknown>)['__chaptifyTgAuth'] = undefined;
      }
    };
  }, [botName, authUrl, hasOnAuth]);

  return <div ref={containerRef} className="tg-widget-host" />;
}
