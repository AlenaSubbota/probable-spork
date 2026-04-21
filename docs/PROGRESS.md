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

## Предстоит

### Миграции — накатить на Supabase в порядке
1. `001_roles_coins_subscriptions.sql`
2. `002_catalog_extensions.sql`
3. `003_quotes_recommendations.sql`

После 001 — проверить что `user_name = 'alena'` в UPDATE в 001 совпадает с твоим реальным профилем.

### Известные недоделки
- **Поиск** в шапке не работает (нужен `pg_trgm` или отдельный индекс)
- **`/feed`** (лента обновлений) — ссылки ведут в никуда
- **Страница переводчика `/t/alena`** — клики по имени переводчика не работают
- **`/beta`** — middleware на неё редиректит, но самой страницы нет
- **`coin_balance` в шапке** — после применения 001 вывести бейдж-монетку в `SiteHeader`
- **Коллекция цитат в профиле** — UI ещё нет, таблица уже есть
- **Middleware → Proxy** — Next.js 16 объявил `middleware` устаревшим, переименовать `src/middleware.ts` → `src/proxy.ts`
- **Кнопка «♥ В закладки»** на странице новеллы не работает (нужен клиентский хендлер + запись в `profiles.bookmarks`)
- **«Похожее» fallback** — ранжирование по score как в tene; сейчас просто по автору
- **Пагинация глав на странице новеллы** — когда >100 глав, грузятся все
- **Покупка платной главы** — RPC `buy_chapter` уже есть, но UI кнопки «Купить» ведёт в никуда
- **Комментарии** — текущий `CommentsSection` использует `chapter_id` и поле `content`/`profiles.username`, которые в реальной схеме называются иначе (`chapter_number` + `text` + `profiles.user_name`). Требуется привести к реальной схеме tene.

### Будущие идеи
- Real-time «кто сейчас читает эту новеллу» через Supabase realtime presence
- Читательские клубы с общим прогрессом
- Аудиоозвучка главы через TTS
- Dark mode для читалки (тёплый серый на очень тёмном)
- Dashboard переводчика со статистикой просмотров/покупок
