import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import PaymentMethodsEditor from '@/app/profile/settings/PaymentMethodsEditor';

export const metadata = { title: 'Способы оплаты · Админка — Chaptify' };

const PROVIDERS: Array<{
  key: string;
  label: string;
  icon: string;
  desc: string;
}> = [
  { key: 'boosty',   label: 'Boosty',    icon: '💛', desc: 'Подписки и тиры на boosty.to' },
  { key: 'tribute',  label: 'Tribute',   icon: '💰', desc: 'Платные подписки в Telegram' },
  { key: 'vk_donut', label: 'VK Donut',  icon: '🟦', desc: 'Донаты VK-сообщества' },
  { key: 'patreon',  label: 'Patreon',   icon: '🧡', desc: 'Международные подписки' },
  { key: 'other',    label: 'Другое',    icon: '✨', desc: 'Любая другая платформа' },
];

const STEPS: Array<{ n: string; title: string; text: string }> = [
  {
    n: '1',
    title: 'Подключи платформу',
    text: 'Boosty, Tribute, VK Donut, Patreon — добавляй любые, в любом порядке.',
  },
  {
    n: '2',
    title: 'Читатель выбирает удобное',
    text: 'На paywall платных глав читатели увидят все твои подключённые способы.',
  },
  {
    n: '3',
    title: 'Получаешь оплату напрямую',
    text: 'Chaptify не проводит платежи через себя и не берёт комиссию.',
  },
];

const FAQ: Array<{ q: string; a: React.ReactNode }> = [
  {
    q: 'Берёт ли Chaptify комиссию?',
    a: (
      <>
        Нет. Chaptify только показывает читателю твои способы оплаты и
        проверяет, что подписка реально куплена. Деньги идут на твой счёт
        Boosty / Tribute / VK напрямую — мы их даже не видим.
      </>
    ),
  },
  {
    q: 'Что такое «автосинк»?',
    a: (
      <>
        Это когда мы сами проверяем, что читатель состоит в твоём закрытом
        Telegram-чате подписчиков (Boosty / Tribute), и автоматически открываем
        ему платные главы — без claim-кодов и ручного подтверждения. Включается
        отдельно для каждого Boosty/Tribute-метода.
      </>
    ),
  },
  {
    q: 'Можно подключить несколько способов?',
    a: (
      <>
        Да, и это рекомендуется. Boosty удобен для русскоязычных, Patreon — для
        зарубежных, Tribute — для тех, кто живёт в Telegram. Чем больше
        вариантов, тем выше шанс, что читатель найдёт удобный.
      </>
    ),
  },
  {
    q: 'Что увидит читатель, если у меня ничего не подключено?',
    a: (
      <>
        Только кнопку «оплатить монетами Chaptify» (если ты её не отключил в
        настройках). Большинство читателей платит внешними подписками — без них
        ты теряешь деньги.
      </>
    ),
  },
  {
    q: 'Можно ли временно скрыть способ?',
    a: (
      <>
        Да — нажми ◐ напротив метода, и он перестанет показываться читателям, но
        не удалится. Удобно, если, например, у Boosty временные проблемы.
      </>
    ),
  },
];

export default async function PaymentMethodsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_admin, translator_slug, translator_display_name, accepts_coins_for_chapters')
    .eq('id', user.id)
    .maybeSingle();

  const p = profile as {
    role?: string;
    is_admin?: boolean;
    translator_slug?: string | null;
    translator_display_name?: string | null;
    accepts_coins_for_chapters?: boolean | null;
  } | null;

  const isAdmin = p?.is_admin === true || p?.role === 'admin';
  const isTranslator = isAdmin || p?.role === 'translator';
  if (!isTranslator) redirect('/translator/apply');

  const acceptsCoins = p?.accepts_coins_for_chapters ?? true;
  const slug = p?.translator_slug ?? null;

  return (
    <main className="container admin-page pm-page">
      <div className="admin-breadcrumbs">
        <Link href="/admin">Админка</Link>
        <span>/</span>
        <span>Способы оплаты</span>
      </div>

      <header className="pm-hero">
        <div className="pm-hero-text">
          <span className="pm-hero-eyebrow">💳 Платные главы</span>
          <h1 className="pm-hero-title">Способы оплаты</h1>
          <p className="pm-hero-sub">
            Подключи платформы, через которые читатели оплачивают подписку на
            твои платные главы. Chaptify не проводит платежи и не берёт
            комиссию — оплата идёт напрямую от читателя к тебе.
          </p>
          <div className="pm-hero-status">
            <span className={`pm-status-pill ${acceptsCoins ? 'is-on' : 'is-off'}`}>
              <span className="pm-status-dot" aria-hidden="true" />
              Внутренние монеты:&nbsp;
              <strong>{acceptsCoins ? 'принимаются' : 'выключены'}</strong>
            </span>
            {slug ? (
              <Link href={`/t/${slug}`} className="btn btn-ghost pm-hero-preview">
                👁 Так видит читатель
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      <section className="pm-steps" aria-label="Как это работает">
        {STEPS.map((s) => (
          <div key={s.n} className="pm-step">
            <div className="pm-step-num" aria-hidden="true">{s.n}</div>
            <div className="pm-step-body">
              <h3 className="pm-step-title">{s.title}</h3>
              <p className="pm-step-text">{s.text}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="pm-providers" aria-label="Поддерживаемые платформы">
        <h2 className="pm-section-title">Поддерживаемые платформы</h2>
        <div className="pm-providers-grid">
          {PROVIDERS.map((pr) => (
            <div key={pr.key} className="pm-provider-card">
              <div className="pm-provider-icon" aria-hidden="true">{pr.icon}</div>
              <div className="pm-provider-name">{pr.label}</div>
              <div className="pm-provider-desc">{pr.desc}</div>
            </div>
          ))}
        </div>
      </section>

      <PaymentMethodsEditor translatorId={user.id} />

      <section className="pm-faq" aria-label="Частые вопросы">
        <h2 className="pm-section-title">Частые вопросы</h2>
        <div className="pm-faq-list">
          {FAQ.map((item, i) => (
            <details key={i} className="pm-faq-item">
              <summary className="pm-faq-q">
                <span className="pm-faq-q-text">{item.q}</span>
                <span className="pm-faq-q-icon" aria-hidden="true">+</span>
              </summary>
              <div className="pm-faq-a">{item.a}</div>
            </details>
          ))}
        </div>
      </section>

      <section className="pm-cta">
        <div className="pm-cta-text">
          <strong>Нужна тонкая настройка?</strong>
          <span>
            Имя, аватар, монеты за главы и другие настройки переводчика —
            на странице профиля.
          </span>
        </div>
        <Link href="/profile/settings" className="btn btn-ghost">
          Настройки профиля →
        </Link>
      </section>
    </main>
  );
}
