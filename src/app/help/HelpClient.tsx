'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

interface QA {
  id: string;
  section: 'reader' | 'translator' | 'payment' | 'account' | 'tech';
  question: string;
  answer: React.ReactNode;
  keywords?: string[];   // для быстрого поиска
}

const SECTION_LABELS: Record<QA['section'], { label: string; emoji: string }> = {
  reader:     { label: 'Читателям',     emoji: '📖' },
  translator: { label: 'Переводчикам',  emoji: '✍️' },
  payment:    { label: 'Оплата',        emoji: '💳' },
  account:    { label: 'Аккаунт',       emoji: '👤' },
  tech:       { label: 'Техподдержка',  emoji: '🔧' },
};

const QAS: QA[] = [
  // --- Читателям ---
  {
    id: 'what-is-chaptify',
    section: 'reader',
    question: 'Что такое Chaptify и чем он отличается от tene.fun?',
    keywords: ['tene', 'отличия', 'что это'],
    answer: (
      <>
        <p>
          Chaptify — десктопная и мобильная веб-версия, где переводчики
          публикуют свои работы, а читатели оформляют подписки и открывают
          платные главы. Tene.fun — это прежний сайт и Telegram Mini App,
          где есть такие же новеллы, но интерфейс проще.
        </p>
        <p>
          <b>Самое главное</b>: у обоих сайтов одна база пользователей.
          Ты можешь войти на chaptify.ru теми же данными, что на tene — и
          вся история чтения, закладки, монеты и подписки останутся на месте.
        </p>
      </>
    ),
  },
  {
    id: 'how-coins-work',
    section: 'reader',
    question: 'Как работают монеты?',
    keywords: ['монеты', 'баланс', 'пополнить', 'покупка', 'кошелёк'],
    answer: (
      <>
        <p>
          Монеты — пред-оплаченные «кредиты» у конкретного переводчика.
          У каждого переводчика свой кошелёк: 300 монет у Алёны и 150 у
          Маши — это <b>два разных баланса</b>, тратить их можно только
          на новеллы своего переводчика.
        </p>
        <p>
          Покупаются на странице переводчика — <code>/t/&lt;ник&gt;</code>,
          блок «кошелёк у этого переводчика» → «Пополнить». Деньги идут{' '}
          <b>напрямую</b> переводчику (Boosty / Tribute / карта), сhaptify
          кассу не держит. После одобрения заявки переводчиком баланс на
          сайте автоматически обновляется.
        </p>
        <p>
          Как ориентир — 1 монета ≈ 1 рубль. Точные цены и бонусы переводчик
          устанавливает сам.
        </p>
      </>
    ),
  },
  {
    id: 'how-subscription-works',
    section: 'reader',
    question: 'В чём разница между подпиской и монетами?',
    keywords: ['подписка', 'выгоднее', 'boosty', 'tribute'],
    answer: (
      <>
        <p>
          <b>Монеты</b> — штучно. Купил 100 монет у Маши — открываешь
          только её платные главы, по 10 монет за штуку. Удобно если хочешь
          3–4 главы, а не весь каталог.
        </p>
        <p>
          <b>Подписка</b> — на месяц, открывает все платные главы этого
          переводчика сразу. Оформляется на его Boosty / Tribute напрямую,
          а Chaptify проверяет факт подписки и открывает доступ.
        </p>
        <p>
          Выгоднее подписка, если читаешь одного переводчика много. Выгоднее
          монеты, если читаешь разных понемногу.
        </p>
      </>
    ),
  },
  {
    id: 'why-per-translator-coins',
    section: 'reader',
    question: 'Почему монеты отдельные у каждого переводчика?',
    keywords: ['кошелёк', 'per-translator', 'налоги', 'самозанятый'],
    answer: (
      <>
        <p>
          Потому что деньги <b>не проходят через chaptify</b>. Платформа —
          это учёт «кто кому сколько предоплатил», а сам платёж — прямой:
          читатель → переводчику. Если бы монеты были «общими», сайт пришлось
          бы превращать в кассу-посредника, а это уже лицензированная
          деятельность.
        </p>
        <p>
          Per-translator кошельки — как подарочные карты. Карта кафе А
          не работает в кафе Б, даже если оба продают кофе.
        </p>
      </>
    ),
  },
  {
    id: 'shelf-and-bookmarks',
    section: 'reader',
    question: 'Где мои закладки и как они работают?',
    keywords: ['закладки', 'полка', 'библиотека'],
    answer: (
      <>
        <p>
          Вся твоя полка — на странице{' '}
          <Link href="/bookmarks" className="more">«Моя библиотека»</Link>.
          Сайт сам раскладывает новеллы по статусам: Читаю / На паузе / В планах /
          Прочитано / Заброшено — на основе того, когда ты последний раз
          открывал главу и сколько прочёл.
        </p>
        <p>
          Значок <b>♥</b> на карточке новеллы — добавляет в закладки.
        </p>
      </>
    ),
  },
  {
    id: 'quotes',
    section: 'reader',
    question: 'Как сохранять цитаты из глав?',
    keywords: ['цитаты', 'выделение', 'коллекция'],
    answer: (
      <p>
        Выделяй любую фразу внутри главы — рядом появляется всплывающая
        кнопка «⊹ Сохранить цитату». Все сохранённые — в профиле, в
        блоке «Мои цитаты», сгруппированы по новелле. Удобно, чтобы
        вернуться к любимому моменту, не перечитывая всю главу.
      </p>
    ),
  },

  // --- Переводчикам ---
  {
    id: 'become-translator',
    section: 'translator',
    question: 'Как стать переводчиком на Chaptify?',
    keywords: ['переводчик', 'стать', 'заявка'],
    answer: (
      <>
        <p>
          Зайди на <Link href="/translator/apply" className="more">/translator/apply</Link>,
          заполни заявку: мотивация, портфолио (если есть), языки, с которых
          переводишь. Мы рассматриваем за 1–3 дня.
        </p>
        <p>
          После одобрения получишь роль <code>translator</code>, доступ в
          админку, возможность добавлять свои новеллы и настраивать способы
          выплат.
        </p>
      </>
    ),
  },
  {
    id: 'add-novel',
    section: 'translator',
    question: 'Как добавить новеллу?',
    keywords: ['добавить', 'новелла', 'создать'],
    answer: (
      <>
        <p>
          В шапке → <b>+ Новелла</b>. Заполни название на 3 языках (оригинал,
          английский, русский), автора тоже в 3 вариантах, выбери жанры и
          опиши сюжет в BB-кодах. Обложку можно перетащить в поле слева.
        </p>
        <p>
          После создания перейдёшь на страницу редактирования, где добавляются
          главы (по одной или массово) и ведётся глоссарий.
        </p>
      </>
    ),
  },
  {
    id: 'bulk-upload',
    section: 'translator',
    question: 'Как загрузить сразу много глав?',
    keywords: ['массовая загрузка', 'много глав', 'импорт'],
    answer: (
      <>
        <p>
          На странице редактирования новеллы → кнопка <b>📚 Массовая
          загрузка</b>. Вставь текст всех глав сразу одним полем.
          Перед началом каждой главы поставь строку <code>Глава 1</code>,
          <code>Глава 2</code> и т.д. — сайт распознаёт и разобьёт на
          отдельные главы автоматически.
        </p>
        <p>
          Можно указать, с какой главы делать платными, или задать
          дефолт «все платные». Перед загрузкой покажет предпросмотр:
          сколько глав получилось, сколько в каждой слов, какие будут
          платными.
        </p>
      </>
    ),
  },
  {
    id: 'glossary',
    section: 'translator',
    question: 'Зачем глоссарий и как он работает?',
    keywords: ['глоссарий', 'термины', 'персонажи', 'единообразие'],
    answer: (
      <p>
        Глоссарий — это словарь имён и терминов твоей новеллы («Алёна», «金丹 →
        золотое ядро»). Он помогает не сбиться с переводом одних и тех же
        слов по-разному. В форме главы сайт подсвечивает совпадения с
        глоссарием прямо в предпросмотре, плюс показывает счётчик. Читатели
        в будущем смогут тапать на подсвеченный термин и видеть объяснение.
      </p>
    ),
  },
  {
    id: 'payouts-setup',
    section: 'translator',
    question: 'Как настроить выплаты — Boosty и Tribute?',
    keywords: ['оплата', 'выплаты', 'boosty', 'tribute', 'webhook'],
    answer: (
      <>
        <p>
          Страница <Link href="/admin/payouts" className="more">/admin/payouts</Link>.
          Два блока:
        </p>
        <ul>
          <li>
            <b>Tribute (рекомендуем новым)</b> — копируешь свой уникальный
            webhook URL, вставляешь в Tribute, выбираешь события. 2 минуты
            настройки, дальше автоматически.
          </li>
          <li>
            <b>Boosty</b> — просто ссылка на твою страницу. Авто-сверки нет
            (у Boosty нет публичного API). Если уже есть аудитория там, клади
            ссылку; подписку активируешь вручную по коду в комментарии.
          </li>
        </ul>
        <p>
          <b>Новый переводчик</b> — бери Tribute, сэкономишь себе нервы.
        </p>
      </>
    ),
  },
  {
    id: 'chapter-money',
    section: 'translator',
    question: 'Как устроены монеты и как я получаю деньги?',
    keywords: ['монеты', 'деньги', 'прибыль', 'самозанятый', 'без посредника'],
    answer: (
      <>
        <p>
          <b>Chaptify деньги не проводит.</b> Читатель платит тебе напрямую —
          через твой Boosty / Tribute / VK Donut / перевод на карту —
          и указывает в комментарии код, который показал ему сайт. Ты сверяешь
          платёж в своём банке / на Boosty и нажимаешь «Одобрить» в{' '}
          <Link href="/admin/subscribers" className="more">/admin/subscribers</Link>.
          В этот момент монеты появляются на его балансе у тебя.
        </p>
        <p>
          <b>Налоги</b> платишь ты — как самозанятый / ИП / физлицо. Это твой
          доход за перевод, chaptify никак не участвует в расчётах и
          не выдаёт чеки вместо тебя. Boosty и Tribute при самозанятой схеме
          сами пробивают чеки в ФНС.
        </p>
        <p>
          <b>Почему так:</b> самозанятый не может быть финансовым посредником
          по 422-ФЗ. Если бы chaptify принимал деньги и пересылал их тебе —
          это было бы эквайрингом с лицензией. Мы этого сознательно не делаем,
          поэтому переводчик всегда получает деньги напрямую.
        </p>
      </>
    ),
  },
  {
    id: 'coins-explained-translator',
    section: 'translator',
    question: 'Зачем вообще монеты, если есть прямой перевод?',
    keywords: ['монеты', 'зачем', 'микроплатёж'],
    answer: (
      <>
        <p>
          Монеты — удобный микроплатёж для читателя. Вместо того чтобы каждую
          неделю переводить тебе по 30 ₽ за главу (Boosty берёт комиссию даже
          с маленьких сумм), он один раз закидывает 500 ₽ и потом спокойно
          открывает 50 глав по клику.
        </p>
        <p>
          С твоей стороны это означает: одна транзакция в банке вместо
          пятидесяти, одна записка в ФНС вместо горы. И твои подписки
          (ежемесячные на Boosty) — тоже работают, параллельно монетам.
        </p>
        <p>
          Если монеты тебе не нужны (принимаешь только месячные подписки) —
          выключи тумблер «Монеты за главы» в{' '}
          <Link href="/profile/settings" className="more">настройках профиля</Link>.
        </p>
      </>
    ),
  },
  {
    id: 'payout-schedule',
    section: 'translator',
    question: 'Когда приходят деньги и как?',
    keywords: ['когда деньги', 'график', 'выплата', 'график выплат', 'реквизиты'],
    answer: (
      <>
        <p>
          Сразу. Читатель переводит тебе деньги, ты их получаешь на свой
          счёт / Boosty / Tribute — без задержек и без участия chaptify.
          Монеты на сайте — это только учёт того, что «читатель Х предоплатил
          тебе N монет вперёд».
        </p>
        <p>
          Способ перевода от читателя тебе — любой, какой ты настроил_а
          в «Способах оплаты»: Boosty, Tribute, VK Donut, Patreon, просто
          карта. Комиссии платформ (Boosty ~7%, Tribute ~3%) оставляет
          сама платформа, chaptify этого не видит и не учитывает.
        </p>
        <p style={{ color: 'var(--ink-mute)', fontSize: 12.5 }}>
          Историческая справка: до мигр. 045 chaptify держал единый
          «платформенный кошелёк» и админ раз в месяц разносил деньги.
          Модель сменилась — платёж теперь напрямую.
        </p>
      </>
    ),
  },

  // --- Оплата ---
  {
    id: 'pay-methods',
    section: 'payment',
    question: 'Какие способы оплаты доступны?',
    keywords: ['карта', 'tribute', 'boosty', 'крипта'],
    answer: (
      <>
        <p><b>Сейчас работают:</b></p>
        <ul>
          <li><b>Tribute</b> в Telegram — карты РФ, крипта. Быстро, не надо никуда регистрироваться.</li>
          <li><b>Boosty</b> — удобно если у тебя уже есть там аккаунт.</li>
        </ul>
        <p><b>Подумать:</b> Yandex OAuth, прямые карты, СБП.</p>
      </>
    ),
  },
  {
    id: 'pay-not-credited',
    section: 'payment',
    question: 'Я оплатил, но монеты не пришли',
    keywords: ['не пришли монеты', 'пропала оплата', 'помогите'],
    answer: (
      <>
        <p>
          Сначала проверь, что в комментарии к платежу указан твой{' '}
          <Link href="/profile/topup" className="more">персональный код</Link>.
          Без него мы не можем связать платёж с твоим аккаунтом на сайте.
        </p>
        <p>
          Если код был — напиши в{' '}
          <a href="https://t.me/tenebrisverbot" className="more">@tenebrisverbot</a>{' '}
          скриншот платежа и свой никнейм, разберёмся руками.
        </p>
      </>
    ),
  },
  {
    id: 'refund',
    section: 'payment',
    question: 'Можно ли вернуть монеты / подписку?',
    keywords: ['возврат', 'рефанд'],
    answer: (
      <p>
        Монеты с баланса не возвращаются (это цифровой контент).
        Если что-то пошло не так — напиши в{' '}
        <a href="https://t.me/tenebrisverbot" className="more">@tenebrisverbot</a>,
        разберёмся индивидуально.
      </p>
    ),
  },

  // --- Аккаунт ---
  {
    id: 'login',
    section: 'account',
    question: 'Как войти, если я уже есть на tene.fun?',
    keywords: ['войти', 'tene', 'аккаунт', 'миграция'],
    answer: (
      <p>
        Просто нажми «Войти через Telegram» — и подгрузится твой старый
        аккаунт с tene. База общая, ничего переносить не надо. Если
        регистрировался по email — те же логин/пароль.
      </p>
    ),
  },
  {
    id: 'change-name',
    section: 'account',
    question: 'Как поменять имя или аватар?',
    keywords: ['имя', 'аватар', 'никнейм'],
    answer: (
      <p>
        Пока настройки профиля в работе — меняется через Telegram-бота{' '}
        <a href="https://t.me/tenebrisverbot" className="more">@tenebrisverbot</a>.
        Скоро сделаем отдельную страницу настроек.
      </p>
    ),
  },

  // --- Технические ---
  {
    id: 'nothing-works',
    section: 'tech',
    question: 'Сайт не открывается / глава не грузится',
    keywords: ['ошибка', 'не работает', 'белый экран'],
    answer: (
      <>
        <p>Попробуй по порядку:</p>
        <ol>
          <li>Обнови страницу (Ctrl+F5 или Cmd+Shift+R — с очисткой кэша)</li>
          <li>Выйди из аккаунта и войди заново</li>
          <li>Проверь, что не используешь VPN / блокировщик, который ломает CORS</li>
          <li>Напиши в <a href="https://t.me/tenebrisverbot" className="more">@tenebrisverbot</a>, указав браузер и что именно не работает</li>
        </ol>
      </>
    ),
  },
  {
    id: 'bug-report',
    section: 'tech',
    question: 'Нашёл баг, куда сообщить?',
    keywords: ['баг', 'сообщить', 'ошибка'],
    answer: (
      <p>
        В Telegram-бот{' '}
        <a href="https://t.me/tenebrisverbot" className="more">@tenebrisverbot</a>{' '}
        — коротко опиши что делала, что ожидала, что получилось. Приложи
        скриншот или видео, если получается. Чинится обычно за 1–2 дня.
      </p>
    ),
  },
];

export default function HelpClient() {
  const [query, setQuery] = useState('');
  const [activeSection, setActiveSection] = useState<QA['section'] | 'all'>('all');

  // Киллер-фича #1: инстант-поиск
  const filtered = useMemo(() => {
    const nq = query.trim().toLowerCase();
    let list = QAS;
    if (activeSection !== 'all') list = list.filter((q) => q.section === activeSection);
    if (!nq) return list;
    return list.filter((q) => {
      const haystack = [
        q.question,
        ...(q.keywords ?? []),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(nq);
    });
  }, [query, activeSection]);

  // Группировка
  const bySection = filtered.reduce((acc, q) => {
    (acc[q.section] ??= []).push(q);
    return acc;
  }, {} as Record<QA['section'], QA[]>);

  return (
    <main className="container section help-page">
      <header className="help-head">
        <h1>Справка Chaptify</h1>
        <p className="help-sub">
          Ответы на вопросы читателей и переводчиков. Не нашла нужного —{' '}
          <a href="https://t.me/tenebrisverbot" className="more">напиши нам</a>.
        </p>
      </header>

      {/* Киллер-фича #1: инстант-поиск */}
      <input
        type="search"
        className="help-search"
        placeholder="Опиши вопрос двумя словами — ответ найдётся…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {/* Киллер-фича #2: табы-якоря */}
      <nav className="bookmark-tabs" style={{ marginTop: 16 }}>
        <button
          type="button"
          className={`bookmark-tab${activeSection === 'all' ? ' active' : ''}`}
          onClick={() => setActiveSection('all')}
        >
          Всё
        </button>
        {(Object.entries(SECTION_LABELS) as [QA['section'], typeof SECTION_LABELS[QA['section']]][]).map(
          ([key, meta]) => (
            <button
              type="button"
              key={key}
              className={`bookmark-tab${activeSection === key ? ' active' : ''}`}
              onClick={() => setActiveSection(key)}
            >
              {meta.emoji} {meta.label}
            </button>
          )
        )}
      </nav>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <p>По запросу «{query}» ничего не нашлось.</p>
          <a href="https://t.me/tenebrisverbot" className="btn btn-primary">
            Написать в поддержку
          </a>
        </div>
      ) : (
        Object.entries(bySection).map(([section, items]) => (
          <section key={section} className="help-section" id={section}>
            <h2>
              {SECTION_LABELS[section as QA['section']].emoji}{' '}
              {SECTION_LABELS[section as QA['section']].label}
            </h2>
            <div className="help-qa-list">
              {items.map((q) => (
                <details key={q.id} className="help-qa" id={q.id}>
                  <summary>
                    <span>{q.question}</span>
                    <span className="help-qa-chev" aria-hidden="true">›</span>
                  </summary>
                  <div className="help-qa-answer">{q.answer}</div>
                </details>
              ))}
            </div>
          </section>
        ))
      )}

      {/* Киллер-фича #3: CTA «не нашла ответ» */}
      <section className="help-cta">
        <div>
          <h3>Не нашла ответ?</h3>
          <p>
            Напиши нам в Telegram — ответим лично, обычно за пару часов. Мы
            читаем каждое сообщение и исправляем проблемы, которые всплывают.
          </p>
        </div>
        <a
          href="https://t.me/tenebrisverbot"
          className="btn btn-primary"
          target="_blank"
          rel="noreferrer"
        >
          ✉ Написать в бота
        </a>
      </section>
    </main>
  );
}
