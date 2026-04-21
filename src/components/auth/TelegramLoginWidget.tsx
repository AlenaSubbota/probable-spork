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

interface Props {
  botName: string;
  onAuth: (user: TelegramUser) => void;
}

// Загружает виджет telegram-widget.js. Работает только если домен chaptify.ru
// зарегистрирован у бота в BotFather (Bot Settings → Domain).
export default function TelegramLoginWidget({ botName, onAuth }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onAuthRef = useRef(onAuth);

  useEffect(() => {
    onAuthRef.current = onAuth;
  }, [onAuth]);

  useEffect(() => {
    if (containerRef.current?.querySelector('script')) return;

    // Глобальный коллбэк, на который повесится виджет
    (window as unknown as { onChaptifyTelegramAuth?: (u: TelegramUser) => void }).onChaptifyTelegramAuth = (user: TelegramUser) => {
      onAuthRef.current(user);
    };

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', botName);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '10');
    script.setAttribute('data-request-access', 'write');
    script.setAttribute('data-userpic', 'false');
    script.setAttribute('data-onauth', 'onChaptifyTelegramAuth(user)');
    script.async = true;

    if (containerRef.current) {
      containerRef.current.innerHTML = '';
      containerRef.current.appendChild(script);
    }

    return () => {
      (window as unknown as { onChaptifyTelegramAuth?: unknown }).onChaptifyTelegramAuth = undefined;
    };
  }, [botName]);

  return <div ref={containerRef} className="tg-widget-host" />;
}
