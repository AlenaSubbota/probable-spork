# Chaptify — прогресс интеграции

Статусный документ по итерациям разработки сайта chaptify.ru. Обновляется в конце каждой итерации.

---

## Итерация 1 — главная страница + каркас

### Сделано
- `SiteHeader` (server component) с навигацией, поиском, кнопкой профиля/входа
- `SiteFooter` (минимальный)
- `layout.tsx`: Inter + Lora через `next/font/google` → `--font-sans` / `--font-serif`
- `WeeklyHero` с живыми данными (новые главы за неделю, свежее обновление)
- `GenreChips` с агрегацией жанров из `novels.genres` jsonb
- `ContinueReadingShelf` + `MyShelfStrip` для залогиненного пользователя (из `profiles.last_read` / `bookmarks`)
- CSS для полок (`.shelf-scroll`, `.continue-card`, `.shelf-strip`, `.shelf-thumb`)

### SQL миграция 001 — `migrations/001_roles_coins_subscriptions.sql`
Накатывать **вручную** на Supabase. Безопасно для tene.fun.
- `profiles.role`, `translator_slug`, `coin_balance`, прочие колонки переводчика
- `novels.translator_id` + обратная совместимость (все старые новеллы получают Алёну)
- Таблицы: `subscriptions`, `coin_transactions`, `chapter_purchases`
- RPC: `add_coins`, `buy_chapter`, `can_read_chapter`, `get_user_subscription_status`

---

## Итерация 2 — каталог + 3 киллер-фичи

### Сделано
- `/catalog` — серверные фильтры через URL query params (SSR, shareable-ссылки)
- Сайдбар с 5 группами фильтров: Настроение · Время чтения · Статус · Жанр · Сортировка
- Пагинация с эллипсисом, 24 на страницу
- Пустое состояние

### Киллер-фичи каталога

1. **«Настроение»** — `src/components/MoodPicker.tsx`, `src/lib/catalog.ts::MOODS`
   6 карточек: 🥺 Поплакать · 🍵 Уютно · ⚔️ Адреналин · 😄 Посмеяться · 🧠 Подумать · 💕 Любовь. Каждое настроение — набор жанров + минимальный рейтинг.

2. **«Время чтения»** — бейдж на карточке (~8 ч, ~2 дн.), фильтр-баскеты Быстро/На вечер/Марафон/Эпос. Формула: `chapter_count × 15 мин`.

3. **«Забытое на полпути»** — `src/components/ForgottenNovels.tsx`. Персональная секция на главной: новеллы, начатые 14+ дней назад и с прогрессом <90%. Кнопка «Продолжить».

### SQL миграция 002 — `migrations/002_catalog_extensions.sql`
- `novels_view` пересоздан с колонками `chapter_count`, `last_chapter_at`, `translator_id`
- Старые колонки view сохранены → tene не сломается
- GIN-индекс на `novels.genres`, индексы на `chapters.novel_id` и `chapters.published_at`

---

## Итерация 3 — страница новеллы + читалка + 3+3 киллер-фичи

### Страница новеллы `/novel/[id]` — новое
- `FirstChapterPreview` — карточка с первым абзацем первой главы и кнопкой «Дочитать» *(киллер #1)*
- `SimilarByReaders` — рекомендации через RPC `get_similar_novels_by_readers` *(киллер #2)*
- `ReleasePace` — столбчатая диаграмма выхода глав за 90 дней + прогноз темпа/дня недели *(киллер #3)*
- Бейдж «~8 ч» рядом с жанровыми note
- Fallback «Похожее от автора» если коллаборативка пустая

### Читалка `/novel/[id]/[chapterNum]`
Перенесли из tene `ChapterReader.jsx`:
- Шрифты: Inter, Lora, Merriweather, Roboto, OpenDyslexic
- Размер шрифта, высота строки, выравнивание, красная строка, отступ абзацев
- Настройки сохраняются в `localStorage` (`chaptify-reader-settings`)
- Прогресс чтения: `localStorage` + `profiles.last_read` (paragraphIndex + chapterId)
- Автовосстановление позиции при повторном заходе
- Горячие клавиши: +/−, F (фокус)
- Буквица на первом абзаце главы

### Киллер-фичи читалки

1. **Фокус-режим** (`src/components/ReaderSettings.tsx` + CSS в `ReaderContent.tsx`)
   Затемняет все абзацы кроме текущего (тот, что ближе к середине вьюпорта). Scroll → смещается активный абзац. Переключается горячей клавишей F.

2. **Умные закладки с цитатами** (`src/components/QuoteBubble.tsx`)
   Выделил текст мышью/тапом → появляется всплывающая кнопка «⊹ Сохранить цитату». Сохраняет в `user_quotes` (таблица с RLS). Коллекция цитат лежит в профиле — можно перечитывать любимое без перечитывания главы.

3. **Таймер сна** (`src/components/SleepTimerOverlay.tsx`)
   Пресеты 15/30/45/60 мин в настройках. По истечении — мягкий overlay «Пора сделать паузу» с кнопками «Ещё 15 минут» или «Спокойной ночи».

### SQL миграция 003 — `migrations/003_quotes_recommendations.sql`
- Таблица `user_quotes` (RLS включён, select/insert/delete только своё)
- RPC `get_similar_novels_by_readers(p_novel_id, p_limit)` — коллаборативная фильтрация
- RPC `get_release_pace(p_novel_id, p_days)` — темп выхода по дням

---

## Итерация 4 — админка: добавление новелл и глав + 3 киллер-фичи для переводчика

### Сделано

**Шапка (SiteHeader)** — кнопки по ролям:
- Гость: `Войти`
- `user`: `Стать переводчиком` + `Профиль`
- `translator`/`admin`: `+ Новелла`, `Админка`, `Профиль`

**Middleware** — упрощена логика беты:
- `/translator/apply` доступна любому залогиненному
- Остальное — только translator/admin; не-переводчики → `/translator/apply` (раньше был `/beta`, теперь отдельная страница не нужна)

### Новые страницы

- `/translator/apply` — форма заявки. Поля: мотивация (20–2000 симв), портфолио, языки (KR/CN/JP/EN), желаемый slug. Показывает статус существующей заявки («pending», «rejected» с комментарием модератора).
- `/admin` — дашборд:
  - Список «Мои новеллы» (для translator) или «Все новеллы» (для admin). Каждая строка: обложка, название, счётчики, статус модерации, кнопки `+ Глава` и `Редактировать`.
  - Секция «Заявки в переводчики» (видна админу): мотивация, slug, языки, кнопки «Одобрить»/«Отклонить» → вызывают RPC `approve_translator_application` / `reject_translator_application`.
- `/admin/novels/new` — создание новеллы.
- `/admin/novels/[id]/edit` — редактирование новеллы + глоссарий на той же странице.
- `/admin/novels/[id]/chapters/new` — создание главы.
- `/admin/novels/[id]/chapters/[chapterNum]/edit` — редактирование главы.

### Страница новеллы — владельцу показываются кнопки
- `+ Добавить главу`, `Редактировать` рядом с «Читать»
- `Править` на каждой строке главы в списке

### Киллер-фичи для переводчика

1. **Глоссарий проекта** — `src/components/admin/GlossaryPanel.tsx` + таблица `novel_glossaries`
   Словарь `термин оригинала → перевод` с категорией (персонаж/место/термин/техника) и примечанием. В форме главы:
   - Сайдбар со списком первых 10 терминов
   - В live-preview pane каждое совпадение с глоссарием подсвечено `<mark class="glossary-match">` (жёлтая подложка), на hover — перевод в title
   - Счётчик «Совпадений с глоссарием: N» в заголовке preview
   
   В будущем: читатель в главе сможет нажать на подсвеченный термин и увидеть объяснение.

2. **Автосохранение черновика** — `src/components/admin/ChapterForm.tsx` + `src/components/admin/DraftBanner.tsx` + таблица `chapter_drafts`
   При изменении content или chapter_number → debounced 2 сек → upsert в `chapter_drafts` (UNIQUE user_id+novel_id+chapter_number). Индикатор «✓ Черновик сохранён». При открытии формы, если для этой новеллы есть черновик — показывается `DraftBanner` с кнопками «Восстановить» / «Начать заново».

3. **Статистика главы в реальном времени** — `src/components/admin/ChapterStats.tsx` + `computeChapterStats()` в `src/lib/admin.ts`
   Сайдбар, обновляется при каждом изменении текста:
   - Слова, знаки, абзацы, расчётное время чтения (180 wpm)
   - Топ-6 повторов (исключая стоп-слова из ~100 русских/английских)
   - Длинные предложения (30+ слов) — с алёртом «Возможно стоит разбить»

### Компоненты админки
- `CoverUpload` — drag & drop загрузка в Supabase Storage bucket `covers`, лимит 5 МБ, превью
- `NovelForm` — все поля: названия на 3-х языках, автор, страна (KR/CN/JP/Other), age rating, год, статус перевода, флажок «оригинал завершён», жанры (предопределённые + свои), описание
- `ChapterForm` — split-view редактор (textarea слева, preview справа), toolbar (¶/B/I/H/❝), номер главы, флажок «Платная»
- `AdminApplications` — UI для админа над таблицей заявок с prompt-диалогами для комментариев
- `DraftBanner` — карточка с офером восстановить черновик

### SQL миграция 004 — `migrations/004_moderation_and_drafts.sql`

Новые колонки в `novels`:
- `moderation_status` ENUM draft/pending/published/rejected
- `title_original`, `title_en`, `alt_titles` jsonb
- `country`, `age_rating`, `translation_status`, `release_year`
- `external_links` jsonb, `rejection_reason` text

Новые таблицы:
- `translator_applications` — заявки с RLS (self-read/insert, admin-all), партиальный UNIQUE index для одной `pending` на пользователя
- `novel_glossaries` — с RLS: читают все, пишут только владелец новеллы или админ
- `chapter_drafts` — с RLS: self-all, UNIQUE (user_id, novel_id, chapter_number)

Новые RPC:
- `approve_translator_application(id, note)` — выставляет `role='translator'` + копирует `desired_slug`
- `reject_translator_application(id, note)`

### Заметки из ranobelib.me (для будущих итераций)

Что понравилось и может пригодиться позже:
- Фон новеллы (баннер поверх обложки) — не делаем сейчас, добавим, когда понадобится визуальный акцент
- Поля «Издатель», «Художник», «Команда озвучки», «Франшиза» — манга-специфика, не нужны для новелл
- Разделение «Статус тайтла» (оригинал) и «Статус перевода» — у нас `is_completed` = статус оригинала, `translation_status` = наш; сделано
- «Загрузка глав: Все / Создатель и переводчики» — ACL на добавление, стоит добавить, когда появятся «команды» переводчиков
- TipTap-редактор для описания — пока textarea с HTML, позже можно заменить на простой contenteditable с toolbar
- «Ссылки на оригинал и анлейт» — колонка `external_links jsonb` уже есть, UI в форме не добавлен
- Sticky footer с алертом «отправится на модерацию» — сделано в .admin-form-footer
- Checkboxes «Маркировка» (ненорм. лексика, наркотики) — можно добавить в будущем, колонок под это нет

## Предстоит

### Миграции — накатить на Supabase в порядке
1. `001_roles_coins_subscriptions.sql`
2. `002_catalog_extensions.sql`
3. `003_quotes_recommendations.sql`
4. `004_moderation_and_drafts.sql`

После 001 — проверить что `user_name = 'alena'` в UPDATE в 001 совпадает с твоим реальным профилем.

### Supabase Storage bucket
Для загрузки обложек и глав через UI должны существовать бакеты `covers` и `chapter_content` с настроенными политиками:
- `covers` — public read, INSERT для authenticated
- `chapter_content` — public read (или только для проверенных, но нам пока ок), INSERT/UPDATE для authenticated

### Известные недоделки
- **Поиск** в шапке не работает (нужен `pg_trgm` или отдельный индекс)
- **`/feed`** (лента обновлений) — ссылки ведут в никуда
- **Страница переводчика `/t/alena`** — клики по имени переводчика не работают
- **`coin_balance` в шапке** — после применения 001 вывести бейдж-монетку в `SiteHeader`
- **Коллекция цитат в профиле** — UI ещё нет, таблица уже есть
- **Middleware → Proxy** — Next.js 16 объявил `middleware` устаревшим, переименовать `src/middleware.ts` → `src/proxy.ts`
- **Кнопка «♥ В закладки»** на странице новеллы не работает (нужен клиентский хендлер + запись в `profiles.bookmarks`)
- **«Похожее» fallback** — ранжирование по score как в tene; сейчас просто по автору
- **Пагинация глав на странице новеллы** — когда >100 глав, грузятся все
- **Покупка платной главы** — RPC `buy_chapter` уже есть, но UI кнопки «Купить» ведёт в никуда
- **Комментарии** — текущий `CommentsSection` использует `chapter_id` и поле `content`/`profiles.username`, которые в реальной схеме называются иначе (`chapter_number` + `text` + `profiles.user_name`). Требуется привести к реальной схеме tene.
- **Глоссарий в читалке** — термины определены, но читатель их пока не видит в тексте главы (подсветка есть только в админке в preview). Сделать inline-tooltip при клике на термин.
- **Модерация новелл** — колонка `moderation_status` есть, но в форме пока всё сразу `published`. Нужен флоу «создать как draft → отправить на модерацию → админ ревьюит».
- **TipTap-редактор** для описания новеллы и текста главы — сейчас HTML-textarea с примитивным toolbar.
- **Массовый импорт глав** — загрузка `.zip` с файлами глав разом.
- **Ссылки на оригинал** (`external_links`) — колонка есть, UI в NovelForm нет.
- **Уведомление переводчика** об одобрении/отказе заявки — сейчас только UI-индикация. Надо инсертить в `notifications` таблицу.

### Будущие идеи
- Real-time «кто сейчас читает эту новеллу» через Supabase realtime presence
- Читательские клубы с общим прогрессом
- Аудиоозвучка главы через TTS
- Dark mode для читалки (тёплый серый на очень тёмном)
- Dashboard переводчика со статистикой просмотров/покупок
