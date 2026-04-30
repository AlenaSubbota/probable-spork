import Link from 'next/link';

export const metadata = {
  title: 'Контакты — Chaptify',
  description:
    'Связаться с командой Chaptify: Telegram-бот поддержки, вопросы переводчиков, баги и предложения.',
};

export default function ContactsPage() {
  return (
    <main className="container section static-page">
      <header className="static-head">
        <h1>Контакты</h1>
        <p className="static-lede">
          Мы маленькая команда и читаем всё, что нам пишут — без бот-автоответов
          и тикет-систем. Самый быстрый канал — Telegram.
        </p>
      </header>

      <section>
        <h2>Куда писать</h2>
        <ul className="contact-list">
          <li>
            <span className="contact-label">Поддержка</span>
            <a
              className="contact-value"
              href="https://t.me/chaptifybot?start=support"
              target="_blank"
              rel="noreferrer"
            >
              @chaptifybot
            </a>
            <span className="contact-hint">
              Главный канал. Баги, вопросы по аккаунту, оплате и подпискам.
              Отвечаем обычно в течение пары часов в будни.
            </span>
          </li>
          <li>
            <span className="contact-label">Сотрудничество</span>
            <a className="contact-value" href="mailto:hello@chaptify.ru">
              hello@chaptify.ru
            </a>
            <span className="contact-hint">
              Партнёрства, интеграции, медиа-запросы, права и лицензии.
              По личным вопросам читателей лучше всё-таки в бота — там
              быстрее.
            </span>
          </li>
          <li>
            <span className="contact-label">Жалобы и DMCA</span>
            <a className="contact-value" href="mailto:abuse@chaptify.ru">
              abuse@chaptify.ru
            </a>
            <span className="contact-hint">
              Нарушение авторских прав, плагиат, оскорбления и любые жалобы
              на контент. Подробности — в{' '}
              <Link href="/rules">правилах сообщества</Link>.
            </span>
          </li>
          <li>
            <span className="contact-label">Стать переводчиком</span>
            <Link className="contact-value" href="/translator/apply">
              /translator/apply
            </Link>
            <span className="contact-hint">
              Короткая заявка — мотивация, портфолио, языки. Рассматриваем
              за 1–3 дня и пишем в личку с решением.
            </span>
          </li>
        </ul>
      </section>

      <section>
        <h2>Перед тем, как писать</h2>
        <p>
          Если вопрос про оплату, монеты, подписку или то, как «почему не
          работает» — большая часть таких вопросов разобрана подробно в{' '}
          <Link href="/help">справке</Link>. Там есть инстант-поиск:
          вписываете два слова — находится ответ.
        </p>
        <p>
          Когда пишете в бота про баг — приложите, пожалуйста:
        </p>
        <ul>
          <li>что делали (короткий пересказ);</li>
          <li>что ожидали увидеть и что увидели на самом деле;</li>
          <li>браузер и устройство (например, «Safari iOS 17»);</li>
          <li>скриншот или короткое видео — если получается.</li>
        </ul>
        <p>
          С такой информацией мы починим в среднем в 2–3 раза быстрее, чем
          по сообщению «у меня ничего не работает».
        </p>
      </section>

      <section>
        <h2>Платежи и спорные ситуации</h2>
        <p>
          <strong>Важно:</strong> деньги за подписки и монеты идут{' '}
          <em>напрямую переводчику</em> — через его Boosty, Tribute, VK Donut,
          Patreon или карту. Chaptify эти платежи не получает и не проводит.
          Поэтому возврат и любые финансовые вопросы решаются <em>с самим
          переводчиком</em>: ссылки на его контакты есть на странице{' '}
          <code>/t/&lt;ник&gt;</code>.
        </p>
        <p>
          Мы можем помочь, если переводчик не выходит на связь больше
          7 дней или явно нарушает правила — напишите нам в бота, мы
          разберёмся и при необходимости ограничим аккаунт.
        </p>
      </section>

      <section>
        <h2>Реквизиты</h2>
        <div className="static-note">
          <strong>Chaptify — учётная платформа, не платёжный сервис.</strong>{' '}
          Мы не выставляем счетов читателям и не выпускаем чеки за
          переводчиков. Если вам нужны юридические реквизиты для договора
          или счёта от <em>самой платформы</em> (например, для рекламного
          сотрудничества) — напишите на{' '}
          <a href="mailto:hello@chaptify.ru">hello@chaptify.ru</a>, вышлем в
          ответ.
        </div>
      </section>
    </main>
  );
}
