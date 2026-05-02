'use client';

import { useEffect, useRef, useState } from 'react';

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
//
// Особый случай: in-app браузер Telegram. Когда юзер открывает
// chaptify.ru ссылкой из чата — страница рендерится в TG WebView. Там
// клик на виджет приводит к попытке открыть oauth.telegram.org, и TG
// перехватывает её через `tg://` deep-link, обрабатывает внутри
// приложения, и **HTTP-редирект на data-auth-url не происходит**. Юзер
// видит «ничего не случилось» / 502 / просто пустой попап. Это
// архитектурное ограничение, не код-баг.
//
// В таком случае мы детектим WebView и вместо виджета показываем
// инструкцию открыть страницу в обычном браузере — там виджет работает
// нормально.

function detectTelegramWebView(): boolean {
  if (typeof window === 'undefined') return false;
  // 1) Если страница запущена как Telegram WebApp (через menu button
  // бота) — у нас доступен Telegram.WebApp.initData. Это технически
  // ТОЖЕ in-app, и виджет тут не работает.
  // 2) Иначе проверяем userAgent: на iOS он содержит «Telegram-iOS», на
  // Android — обычно «Telegram». Это не 100% надёжно (TG может менять
  // UA), но покрывает текущие версии 2024-2026.
  // 3) Дополнительно — приватный объект TelegramWebviewProxy/PostEvent
  // присутствует только внутри WebView.
  const w = window as unknown as {
    Telegram?: { WebApp?: { initData?: string } };
    TelegramWebviewProxy?: unknown;
    TelegramWebview?: unknown;
  };
  if (w.Telegram?.WebApp?.initData) return true;
  if (w.TelegramWebviewProxy || w.TelegramWebview) return true;
  const ua = navigator.userAgent || '';
  return /Telegram(?:-iOS|-Android|Bot)?/i.test(ua);
}

export default function TelegramLoginWidget(props: Props) {
  const { botName } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  // onAuth держим в ref, чтобы пересоздание callback'а в родителе не
  // вызывало переинициализацию виджета (тот не умеет hot-replace атрибутов).
  const onAuthRef = useRef<typeof props.onAuth>(props.onAuth);

  useEffect(() => {
    onAuthRef.current = props.onAuth;
  }, [props.onAuth]);

  // SSR/первый рендер на клиенте: считаем что НЕ в WebView, чтобы
  // hydration совпал. Реальный детект — в useEffect после маунта.
  const [inWebView, setInWebView] = useState(false);

  useEffect(() => {
    setInWebView(detectTelegramWebView());
  }, []);

  // Берём примитивные значения как зависимости, чтобы не пересоздавать
  // виджет при каждом ре-рендере родителя.
  const authUrl = 'authUrl' in props ? props.authUrl : undefined;
  const hasOnAuth = 'onAuth' in props && !!props.onAuth;

  useEffect(() => {
    // В WebView виджет не вставляем — он всё равно не отработает.
    if (inWebView) return;
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
  }, [botName, authUrl, hasOnAuth, inWebView]);

  if (inWebView) {
    return <TgInAppFallback />;
  }

  return <div ref={containerRef} className="tg-widget-host" />;
}

function TgInAppFallback() {
  // Программно вытащить юзера из in-app TG в Safari/Chrome — нельзя:
  // - window.open(url, '_blank') открывает новую вкладку ВНУТРИ TG-браузера
  // - Telegram.WebApp.openLink доступен только в WebApp-launch (через
  //   menu button бота), а не в обычном in-app browser, открытом по ссылке
  // - cookies между TG WebView и Safari/Chrome изолированы — даже если
  //   юзер войдёт в Safari, в TG он останется не залогинен
  //
  // Поэтому НЕ показываем кнопку «Открыть в браузере» (она вводила в
  // заблуждение, открывая страницу снова в TG WebView). Только инструкция
  // — это пользовательский экшен через нативный TG UI, программно
  // вызвать его нельзя, но он всегда работает.
  //
  // Полноценный нативный логин внутри TG возможен через Telegram WebApp
  // и initData — это требует отдельной настройки @chaptifybot через
  // BotFather (/setmenubutton) + backend-обработчик initData. Этот
  // компонент про обычный in-app browser flow.
  return (
    <div className="tg-inapp-fallback">
      <p className="tg-inapp-title">
        Вход через Telegram работает только в обычном браузере
      </p>
      <ol className="tg-inapp-howto">
        <li>
          Нажми <strong>«⋮»</strong> (три точки) сверху справа в этом окне Telegram
        </li>
        <li>
          Выбери <strong>«Открыть в Safari»</strong> (iPhone) или
          <strong> «Открыть в браузере»</strong> (Android)
        </li>
        <li>В браузере уже сможешь войти через Telegram-виджет</li>
      </ol>
      <p className="tg-inapp-altline">
        Если не хочешь переключаться — войди прямо тут через
        <strong> Google</strong> или <strong>email</strong>. Они работают и в Telegram.
      </p>
    </div>
  );
}
