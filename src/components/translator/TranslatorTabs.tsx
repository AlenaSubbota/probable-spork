import Link from 'next/link';

interface Props {
  /** Какой таб подсветить активным. */
  active: 'view' | 'me';
  /** slug переводчика — для ссылки на /t/<slug>. */
  slug: string | null;
}

// Один и тот же человек на сайте «живёт» в двух местах:
//   • /t/<slug>  — публичная витрина: новеллы, кошельки, расписание;
//   • /profile   — личный кабинет: монеты, закладки, подписки.
// Эти два URL остаются (внешние ссылки и старые карточки), но визуально
// мы их склеиваем парой табов, чтобы переключение между «как меня
// видят читатели» и «мои дела» было одним кликом.
//
// Таб-полоса показывается только владельцу — для всех остальных у
// /t/<slug> один режим (витрина), и /profile они физически открыть
// не могут (своя авторизация).
export default function TranslatorTabs({ active, slug }: Props) {
  if (!slug) {
    // Нет slug → показываем только «Мне» отдельно, без переключателя.
    // Скорее всего, это не-переводчик; ему всё равно витринной страницы
    // нет.
    return null;
  }

  return (
    <nav className="translator-tabs" aria-label="Профиль переводчика">
      <Link
        href={`/t/${slug}`}
        className={`translator-tab${active === 'view' ? ' is-active' : ''}`}
        prefetch={false}
      >
        <span aria-hidden="true">📖</span> Витрина
      </Link>
      <Link
        href="/profile"
        className={`translator-tab${active === 'me' ? ' is-active' : ''}`}
        prefetch={false}
      >
        <span aria-hidden="true">⚙</span> Мне
      </Link>
    </nav>
  );
}
