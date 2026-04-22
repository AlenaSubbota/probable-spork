# Сага об авторизации на chaptify.ru

Документ закрывает 2-дневный марафон по отделению chaptify-авторизации от tene. Отдельный файл потому что `PROGRESS.md` уже ≈1200 строк, и тема цельная.

**Итог:** на `chaptify.ru` работают Telegram (через `@chaptifybot`), Google OAuth и email+пароль. Всё живёт рядом с `tene.fun` на одной Supabase без конфликтов.

---

## Что было в начале

- **tene.fun**: Vite SPA, авторизация через `auth-service/` (Node + Express), бот `@tene_bot` с токеном в `my-bot/.env`, Supabase self-hosted в `/root/docker_data/supabase/`
- **chaptify.ru**: Next.js SSR приложение (в Docker как `chaptify-web:3000`), та же Supabase, фронтенд ходил на `tene.fun/auth/telegram` → попадал в tene-ный auth-service и получал 403 `Hash mismatch`, потому что валидировался токеном другого бота

Первая попытка использовать тот же бот и тот же сервис невозможна: Telegram Login Widget привязывается к **одному домену на одного бота**.

---

## 1. Собственный бот `@chaptifybot` (repo `server`, PR #1 — notifications)

Отдельный Telegram-бот для chaptify. Создан через `/newbot` у BotFather, домен привязан к `chaptify.ru`.

Файлы в repo `server/chaptify-bot/`:
- `bot.py` — polling, 5 команд (`/start`, `/help`, `/stop`, `/resume`, `/status`) + фоновая задача рассылки уведомлений каждые 30 секунд
- Фильтр **«важных» типов** для push-уведомлений: `chapter_tip`, `new_subscriber`, `novel_*` (модерация), `translator_application_*`, `novel_claim_*`, `message`, `friend_request` / `accepted`. Обычные комменты и лайки не шлёт (не спамит)
- Кладёт `chaptify_bot_chat_id` в `profiles` при `/start`, уважает `/stop`
- Блокировка юзером → автоматически выключает `chaptify_notifications` в БД, не ломится в 403

Миграция `026_chaptify_bot.sql` в `probable-spork`:
- `profiles.chaptify_bot_chat_id bigint`
- `profiles.chaptify_notifications boolean default true`
- Таблица `chaptify_bot_sent (notification_id, chat_id, sent_at)` — лог, чтобы не дублировать при рестарте бота

Развёрнут как `chaptify-bot.service` (systemd), код в `/root/chaptify-bot/` на сервере. Токен от `@chaptifybot` в `.env`. Работает через polling — никаких правок nginx / firewall не потребовалось.

---

## 2. Отдельный auth-service (repo `server`, PR #2)

По той же причине (один сервис = один токен) для валидации Telegram-подписей нужна вторая копия.

`auth-service-chaptify/` — клон `auth-service/` с минимальными отличиями:
- свой `TELEGRAM_BOT_TOKEN` от `@chaptifybot`
- `HIDDEN_EMAIL_DOMAIN=tene.fun` оставлен (важно!) — чтобы один Telegram-юзер на обоих сайтах попадал в ОДИН `auth.users` через общий email `<tg_id>@tene.fun`, а не в два разных
- `ALLOWED_ORIGINS` настраиваемый через env (csv)
- endpoint `/auth/health` для быстрой проверки деплоя

**Nginx в блоке `server { server_name chaptify.ru; }`** получил:
```nginx
location /auth/telegram {
    limit_req zone=auth_limit burst=10 nodelay;
    proxy_pass http://supabase-auth-tg-chaptify:3000;
    ...
}
location /auth/free-chapter/ {
    proxy_pass http://supabase-auth-tg-chaptify:3000;
    ...
}
```

**Docker-compose** в `/root/nginx-proxy/docker-compose.yml` — новый сервис рядом с `chaptify-web`:
```yaml
supabase-auth-tg-chaptify:
  build: /root/auth-service-chaptify
  container_name: supabase-auth-tg-chaptify
  restart: unless-stopped
  env_file: /root/auth-service-chaptify/.env
  networks: [tene-network, supabase_default]
  expose: ["3000"]
```

### Неожиданный баг: `@supabase/supabase-js` 2.104.0 ломает admin API (PR #3)

На сервере `npm install` по `^2.39.0` тянул свежий `2.104.0`, `admin.createUser` возвращал `401 Invalid authentication credentials`. У работающего tene-auth-service стоял `2.103.0` — там всё ок. Между 2.103 и 2.104 Supabase что-то сломал в admin-пути.

Пинанули точной версией `"2.103.0"` (без `^`).

---

## 3. CORS-правки в nginx (на самом tene.fun vhost)

Следом всплыли проблемы CORS у chaptify-фронта, которых у tene никогда не было — Next.js с `@supabase/ssr` шлёт заголовки, которых старый whitelist не пропускал, и `.update()` через PATCH, которого не было в методах.

В блок Supabase API на `tene.fun`:
```diff
- Access-Control-Allow-Methods: 'GET, POST, OPTIONS, PUT, DELETE'
+ Access-Control-Allow-Methods: 'GET, POST, PATCH, OPTIONS, PUT, DELETE'

- Access-Control-Allow-Headers: '...,apikey,x-supabase-api-version,x-client-info'
+ Access-Control-Allow-Headers: '...,apikey,x-supabase-api-version,x-client-info,Accept-Profile,Content-Profile,Prefer'
```

PATCH был нужен для Supabase `.update()` запросов (PostgREST convention). `Accept-Profile` / `Content-Profile` / `Prefer` — это заголовки `@supabase/ssr` для выбора postgres-схемы.

**Tene это не сломало:** его Vite-клиент эти заголовки не шлёт и PATCH тоже не использует.

---

## 4. Первый вход админа: убрать auth_basic (`probable-spork` PR #12)

После деплоя chaptify-фронт сам по себе ругался «двойная защита». В nginx.conf блок `server { chaptify.ru; }` имел `auth_basic` от времён закрытой беты — убрали.

Одновременно тремя правками в коде:
- **`proxy.ts`** — перешёл с blacklist на whitelist: сессия нужна только на `/admin`, `/profile`, `/bookmarks`, `/friends`, `/messages`, `/notifications`. Всё остальное — каталог, новелла, профиль переводчика — публично. Раньше middleware редиректил любого анонима на `/login`.
- **SiteHeader** — одна кнопка «Войти» разделена на две (`Войти` ghost + `Регистрация` primary). Tene-юзеры кликают «Войти», новые — сразу на регу.
- **AuthForm** — убран magic-link. Supabase одна на оба сайта → шаблон email общий → chaptify-юзер получал «добро пожаловать в tene». Убрали до момента, когда разделим шаблоны per-site.

---

## 5. `NEXT_PUBLIC_*` baked at build time (PR #13, #14)

Нельзя просто поставить `NEXT_PUBLIC_TG_BOT_USERNAME=chaptifybot` в `docker-compose environment:` — в Next.js эти переменные **впекаются в JS-бандл на этапе `npm run build`**, не читаются в runtime.

Обновили `Dockerfile` + `.github/workflows/deploy.yml`, добавив два `ARG`:
```yaml
build-args: |
  NEXT_PUBLIC_SUPABASE_URL=${{ secrets.SUPABASE_URL }}
  NEXT_PUBLIC_SUPABASE_ANON_KEY=${{ secrets.SUPABASE_ANON_KEY }}
  NEXT_PUBLIC_TG_BOT_USERNAME=chaptifybot
  NEXT_PUBLIC_AUTH_API_URL=https://chaptify.ru
```

В PR #14 отдельно исправили опечатку: реальный username — `chaptifybot` (слитно), не `chaptify_bot`.

---

## 6. Hard reload после login (PR #15)

После успешного `setSession()` / `signInWithPassword()` `@supabase/ssr` пишет auth-cookie в `document.cookie`. Но `router.push('/')` делает **client-side** transition — Next.js делает SSR-запрос на новую страницу *до того*, как браузер успевает прикрепить cookie. Server Component `SiteHeader` получает `user=null` и рендерит гостевые кнопки.

Фикс простой: `window.location.href = '/'` вместо `router.push`. Полный HTTP-navigation → браузер прикрепляет cookie → SSR видит юзера → шапка с профилем.

---

## 7. Google OAuth — настройка в Supabase self-hosted

В `/root/docker_data/supabase/docker/.env`:
```env
GOTRUE_EXTERNAL_GOOGLE_ENABLED=true
GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID=<из Google Cloud Console>
GOTRUE_EXTERNAL_GOOGLE_SECRET=<оттуда же>
GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=https://tene.fun/auth/v1/callback

ADDITIONAL_REDIRECT_URLS=https://tene.fun,https://tene.fun/**,https://chaptify.ru,https://chaptify.ru/**,https://www.chaptify.ru,https://www.chaptify.ru/**
```

В `docker-compose.yml` Supabase — пробросить в секцию `auth:` → `environment:` четыре новых `GOTRUE_EXTERNAL_GOOGLE_*` переменные (через `${...}`).

В Google Cloud Console:
- **Authorized JavaScript origins**: `https://tene.fun`, `https://chaptify.ru`
- **Authorized redirect URIs**: `https://tene.fun/auth/v1/callback` (только tene — это общий callback-URL для обоих сайтов)

Tene не затронут: его юзеры уходят на тот же `callback`, оттуда Supabase отправляет их обратно на `tene.fun` через `redirect_to` параметр.

---

## 8. Саге OAuth-callback — три итерации (PR #16, #17, #18, #19)

Google-вход в Supabase логах прошёл успешно (`user_signedup`, `provider: google`), но на chaptify в шапке по-прежнему были гостевые кнопки.

**Итерация 1 (PR #16):** создал `src/app/auth/callback/route.ts` — сервер-route, который обменивает `?code=...` на session через `exchangeCodeForSession`. Supabase шлёт пользователя туда, cookie ложится на chaptify.ru, редирект на `/`.

→ **Не сработало.** В Network было видно: Supabase редиректит не на `/auth/callback`, а на `/?code=...`. Причина: `ADDITIONAL_REDIRECT_URLS` без wildcards — путь усекается до origin.

**Итерация 2 (PR #17):** failsafe в `proxy.ts`: если на любом публичном URL есть `?code=...` и это не `/auth/callback` — редирект на `/auth/callback?code=...`. Плюс обновление `.env` Supabase с wildcards `**`.

→ **Получили 502 Bad Gateway.** Роут пытался обменять код серверно и падал с `PKCE code verifier not found in storage`. Cookie с verifier, которую положил browser-client при `signInWithOAuth`, сервер не видел (смесь доменов `tene.fun` + `chaptify.ru` + `@supabase/ssr`).

Плюс второй баг: при упавшем exchange редирект формировался через `new URL(request.url)` — `request.url` в Next.js standalone содержит docker-hostname (`https://9131dff51115:3000/login`), а не `chaptify.ru`.

**Итерация 3 (PR #18):** удалил server-route, создал `src/app/auth/callback/page.tsx` (client-component). Exchange делается **на клиенте** — там cookie-verifier гарантированно доступен. После успеха `@supabase/ssr` browser-client пишет auth-cookie на `chaptify.ru`, `window.location.href = '/'` = hard reload → SSR видит сессию.

**Итерация 4 (PR #19):** косметика. `@supabase/ssr` browser-client **автоматически** обменивает `?code=` при инициализации (`detectSessionInUrl: true`). Наш manual exchange после этого падал с «code already used», показывал «Ошибка входа» на 1.5 сек, потом всё равно редиректил на главную где юзер уже залогинен. Обернул ручной exchange в `.catch(() => {})`, чистая проверка `getSession()`, и только если реально нет сессии — показываем ошибку.

---

## Итоговая архитектура

```
chaptify.ru                           tene.fun
 │                                     │
 ├── POST /auth/telegram ──────────▶ supabase-auth-tg-chaptify (@chaptifybot token)
 │                                     │                       ↓
 │                                     │                  общий Supabase
 ├── POST /auth/v1/* ──────────────▶ Supabase Auth (GoTrue) ◄──┘
 │     (через tene.fun/auth/v1/*)
 │
 ├── Google login ──────────────────▶ Supabase Auth (GoTrue)
 │                                     │
 │                                     ▼
 │                           tene.fun/auth/v1/callback (общий)
 │                                     │
 └── /auth/callback (client-page) ◄────┘ redirect
      │
      ├── exchangeCodeForSession (PKCE)
      ├── cookie ложится на chaptify.ru
      └── window.location = '/'
```

**Бот `@chaptifybot`:**
- Telegram Login Widget → валидация в `supabase-auth-tg-chaptify`
- `/start` от пользователя → привязка `chaptify_bot_chat_id`
- Фоновая рассылка важных уведомлений из БД

**Данные:**
- Один `auth.users` row на одного Telegram-пользователя (общий email `<tg_id>@tene.fun`)
- Если тот же пользователь логинится через Google — получает **другой** `auth.users` (email `alena@gmail.com`). Это не баг, это фундаментальный вопрос идентичности; решится `linkIdentity` когда понадобится

---

## Миграции, связанные с этой сагой

- `026_chaptify_bot.sql` — флаги бота и sent-лог
- (остальные правки — `.env` / `docker-compose.yml` / `nginx.conf`, а не БД)

## Файлы в repo `server/`

- `chaptify-bot/` — Telegram-бот, 7 файлов
- `auth-service-chaptify/` — auth-микросервис, 5 файлов

## Файлы в repo `probable-spork/`

- `src/app/auth/callback/page.tsx` — client-side OAuth-callback
- `src/proxy.ts` — failsafe для `?code=`, whitelist protected routes
- `src/components/auth/AuthForm.tsx` — hard-reload после login
- `src/components/SiteHeader.tsx` — две кнопки вместо одной
- `Dockerfile` + `.github/workflows/deploy.yml` — build-args для `NEXT_PUBLIC_*`
