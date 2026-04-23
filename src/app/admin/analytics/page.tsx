import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import PeriodCard from '@/components/analytics/PeriodCard';
import TopMoments, { type Moment } from '@/components/analytics/TopMoments';
import NovelsTable, { type NovelMetrics } from '@/components/analytics/NovelsTable';
import TopSupporters, { type Supporter } from '@/components/analytics/TopSupporters';
import HourlyHeatmap, { type HeatmapCell } from '@/components/analytics/HourlyHeatmap';

interface PageProps {
  searchParams: Promise<{ period?: string }>;
}

const VALID_PERIODS = [7, 30, 90] as const;
type PeriodDays = (typeof VALID_PERIODS)[number];

const PERIOD_LABELS: Record<PeriodDays, string> = {
  7: 'неделя',
  30: 'месяц',
  90: '3 месяца',
};

export default async function AnalyticsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const requested = parseInt(params.period ?? '7', 10);
  const period: PeriodDays = VALID_PERIODS.includes(requested as PeriodDays)
    ? (requested as PeriodDays)
    : 7;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profileRaw } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  const profile = profileRaw as { role?: string; is_admin?: boolean } | null;
  const role = profile?.role;
  const isAdminLegacy = profile?.is_admin === true;
  const isTranslator = isAdminLegacy || role === 'translator' || role === 'admin';
  if (!isTranslator) redirect('/translator/apply');
  const isAdmin = isAdminLegacy || role === 'admin';

  // Временные границы
  const now = Date.now();
  const periodStart = new Date(now - period * 86_400_000);
  const periodPrevStart = new Date(now - period * 2 * 86_400_000);
  const periodPrevEnd = periodStart;

  // --- Новеллы переводчика ---
  let novelsQuery = supabase
    .from('novels_view')
    .select(
      'id, firebase_id, title, translator_id, views, average_rating, rating_count, chapter_count'
    );
  if (!isAdmin) novelsQuery = novelsQuery.eq('translator_id', user.id);
  const { data: novelsRaw } = await novelsQuery;
  const novels = novelsRaw ?? [];
  const novelIds = novels.map((n) => n.id);

  if (novels.length === 0) {
    return (
      <main className="container admin-page">
        <div className="admin-breadcrumbs">
          <Link href="/admin">Админка</Link>
          <span>/</span>
          <span>Аналитика</span>
        </div>
        <h1>Аналитика</h1>
        <div className="empty-state">
          <p>Пока нет ни одной новеллы — цифры появятся, как только опубликуешь главу.</p>
          <Link href="/admin/novels/new" className="btn btn-primary">
            + Новелла
          </Link>
        </div>
      </main>
    );
  }

  // --- Параллельно: главы за период + за прошлый период + подписки + рейтинги + покупки ---
  // Для подписок: если админ — смотрим все, иначе только свои.
  const subsBase = () => {
    const q = supabase.from('subscriptions').select('id');
    return isAdmin ? q : q.eq('translator_id', user.id);
  };

  const [
    { data: chaptersPeriod },
    { data: chaptersPrev },
    { data: subsActive },
    { data: subsNewPeriod },
    { data: subsNewPrev },
    { data: ratingsPeriod },
    { data: ratingsPrev },
    { data: txPeriod },
    { data: txPrev },
  ] = await Promise.all([
    supabase
      .from('chapters')
      .select('novel_id, chapter_number, published_at')
      .in('novel_id', novelIds)
      .gte('published_at', periodStart.toISOString()),
    supabase
      .from('chapters')
      .select('novel_id, chapter_number, published_at')
      .in('novel_id', novelIds)
      .gte('published_at', periodPrevStart.toISOString())
      .lt('published_at', periodPrevEnd.toISOString()),
    subsBase().eq('status', 'active'),
    subsBase().gte('started_at', periodStart.toISOString()),
    subsBase()
      .gte('started_at', periodPrevStart.toISOString())
      .lt('started_at', periodPrevEnd.toISOString()),
    supabase
      .from('novel_ratings')
      .select('novel_id, rating, created_at')
      .in('novel_id', novelIds)
      .gte('created_at', periodStart.toISOString()),
    supabase
      .from('novel_ratings')
      .select('novel_id, rating, created_at')
      .in('novel_id', novelIds)
      .gte('created_at', periodPrevStart.toISOString())
      .lt('created_at', periodPrevEnd.toISOString()),
    supabase
      .from('coin_transactions')
      .select('amount, reason, reference_id, created_at')
      .eq('reason', 'chapter_purchase')
      .gte('created_at', periodStart.toISOString()),
    supabase
      .from('coin_transactions')
      .select('amount, reason, reference_id, created_at')
      .eq('reason', 'chapter_purchase')
      .gte('created_at', periodPrevStart.toISOString())
      .lt('created_at', periodPrevEnd.toISOString()),
  ]);

  // --- Фильтруем покупки по нашим новеллам ---
  const novelIdSet = new Set(novelIds);
  const myTxPeriod = (txPeriod ?? []).filter((t) => {
    const nid = parseInt(String(t.reference_id ?? '').split(':')[0], 10);
    return novelIdSet.has(nid);
  });
  const myTxPrev = (txPrev ?? []).filter((t) => {
    const nid = parseInt(String(t.reference_id ?? '').split(':')[0], 10);
    return novelIdSet.has(nid);
  });

  // --- Агрегируем суммарные метрики ---
  const totalChaptersPeriod = chaptersPeriod?.length ?? 0;
  const totalChaptersPrev = chaptersPrev?.length ?? 0;
  const totalPurchasesPeriod = myTxPeriod.length;
  const totalPurchasesPrev = myTxPrev.length;
  const coinsEarnedPeriod = myTxPeriod.reduce((s, t) => s + Math.abs(t.amount ?? 0), 0);
  const coinsEarnedPrev = myTxPrev.reduce((s, t) => s + Math.abs(t.amount ?? 0), 0);
  const newSubsPeriod = subsNewPeriod?.length ?? 0;
  const newSubsPrev = subsNewPrev?.length ?? 0;
  const activeSubsCount = subsActive?.length ?? 0;
  const newRatingsPeriod = ratingsPeriod?.length ?? 0;
  const newRatingsPrev = ratingsPrev?.length ?? 0;

  // --- Метрики по каждой новелле ---
  const chaptersByNovelPeriod = new Map<number, number>();
  for (const c of chaptersPeriod ?? []) {
    chaptersByNovelPeriod.set(c.novel_id, (chaptersByNovelPeriod.get(c.novel_id) ?? 0) + 1);
  }
  const purchasesByNovelPeriod = new Map<number, number>();
  for (const t of myTxPeriod) {
    const nid = parseInt(String(t.reference_id ?? '').split(':')[0], 10);
    if (!isNaN(nid)) purchasesByNovelPeriod.set(nid, (purchasesByNovelPeriod.get(nid) ?? 0) + 1);
  }
  // Подписчики по новелле — распределить можно, если в subscriptions есть novel_id.
  // Сейчас схема — подписка на переводчика целиком, так что активных по novel нет.

  const novelMetrics: NovelMetrics[] = novels
    .map((n) => ({
      id: n.id,
      firebase_id: n.firebase_id,
      title: n.title,
      total_views: (n.views as number) ?? 0,
      rating: n.average_rating ? Number(n.average_rating) : null,
      rating_count: (n.rating_count as number) ?? 0,
      chapters_total: (n.chapter_count as number) ?? 0,
      chapters_period: chaptersByNovelPeriod.get(n.id) ?? 0,
      purchases_period: purchasesByNovelPeriod.get(n.id) ?? 0,
      subscribers_active: 0,
    }))
    .sort((a, b) => b.total_views - a.total_views);

  // --- Автоматические «моменты» ---
  const moments: Moment[] = [];

  if (totalPurchasesPeriod > totalPurchasesPrev * 1.5 && totalPurchasesPeriod >= 5) {
    moments.push({
      icon: '🚀',
      tone: 'positive',
      title: 'Скачок покупок',
      body: `За ${PERIOD_LABELS[period]} купили ${totalPurchasesPeriod} глав — в ${(totalPurchasesPeriod / Math.max(1, totalPurchasesPrev)).toFixed(1)} раза больше, чем за прошлый период.`,
    });
  }

  if (newSubsPeriod > 0 && newSubsPeriod >= newSubsPrev) {
    moments.push({
      icon: '💝',
      tone: 'positive',
      title: `+${newSubsPeriod} ${plural(newSubsPeriod, 'новый подписчик', 'новых подписчика', 'новых подписчиков')}`,
      body: `За ${PERIOD_LABELS[period]} на тебя оформили ${newSubsPeriod} ${plural(newSubsPeriod, 'подписку', 'подписки', 'подписок')}. Сейчас активных: ${activeSubsCount}.`,
    });
  }

  if (totalChaptersPeriod === 0 && totalChaptersPrev > 0) {
    moments.push({
      icon: '⏸',
      tone: 'warning',
      title: 'Пауза в выпусках',
      body: `За ${PERIOD_LABELS[period]} ты не опубликовал_а ни одной главы. Читатели ждут!`,
    });
  }

  // Топ-новелла по приросту просмотров за период (косвенно — по % покупок)
  const topGainer = [...novelMetrics]
    .filter((n) => n.chapters_period > 0 || n.purchases_period > 0)
    .sort((a, b) => b.purchases_period + b.chapters_period - (a.purchases_period + a.chapters_period))[0];
  if (topGainer && (topGainer.chapters_period > 0 || topGainer.purchases_period > 0)) {
    moments.push({
      icon: '⭐',
      tone: 'neutral',
      title: `«${topGainer.title}» в центре внимания`,
      body:
        `${topGainer.chapters_period > 0 ? `${topGainer.chapters_period} ${plural(topGainer.chapters_period, 'новая глава', 'новых главы', 'новых глав')}` : ''}` +
        `${topGainer.chapters_period > 0 && topGainer.purchases_period > 0 ? ', ' : ''}` +
        `${topGainer.purchases_period > 0 ? `${topGainer.purchases_period} ${plural(topGainer.purchases_period, 'покупка', 'покупки', 'покупок')}` : ''}` +
        ` за ${PERIOD_LABELS[period]}.`,
    });
  }

  if (newRatingsPeriod >= 3) {
    const avg = (ratingsPeriod ?? []).reduce((s, r) => s + r.rating, 0) / newRatingsPeriod;
    moments.push({
      icon: avg >= 4.5 ? '🌟' : '📊',
      tone: avg >= 4 ? 'positive' : 'neutral',
      title: `${newRatingsPeriod} ${plural(newRatingsPeriod, 'оценка', 'оценки', 'оценок')} за ${PERIOD_LABELS[period]}`,
      body: `Средняя — ${avg.toFixed(1)} ★.`,
    });
  }

  const periodLabel = `за ${PERIOD_LABELS[period]}`;

  // --- Топ-supporters (кто больше всех платит переводчику за период) ---
  // Админу показываем агрегат по всей платформе (вызываем для каждого translator_id?
  // пока — не показываем, фича именно для переводчика про его читателей).
  let topSupporters: Supporter[] = [];
  if (!isAdmin) {
    try {
      const { data } = await supabase.rpc('translator_top_supporters', {
        p_translator: user.id,
        p_since: periodStart.toISOString(),
        p_limit: 5,
      });
      if (Array.isArray(data)) {
        topSupporters = data.map((r: Record<string, unknown>) => ({
          user_id: String(r.user_id),
          user_name: (r.user_name as string) ?? 'Читатель',
          avatar_url: (r.avatar_url as string | null) ?? null,
          total_coins: Number(r.total_coins ?? 0),
          chapter_count: Number(r.chapter_count ?? 0),
        }));
      }
    } catch {
      // миграция 022 не накачена
    }
  }

  // --- «К выплате» — только для переводчика (не админа) ---
  let pendingPayout: {
    since: string | null;
    coinsGross: number;
    chapterCount: number;
    uniqueBuyers: number;
  } | null = null;
  if (!isAdmin) {
    try {
      const { data } = await supabase.rpc('translator_earnings_pending', {
        p_translator: user.id,
      });
      if (data && typeof data === 'object') {
        const d = data as {
          since: string;
          coins_gross: number;
          chapter_count: number;
          unique_buyers: number;
        };
        pendingPayout = {
          since: d.since,
          coinsGross: Number(d.coins_gross ?? 0),
          chapterCount: Number(d.chapter_count ?? 0),
          uniqueBuyers: Number(d.unique_buyers ?? 0),
        };
      }
    } catch {
      // миграция 011 не накачена
    }
  }

  // Тепловая карта «когда читают» — только для переводчика
  // собственных данных (мигр. 043). Админ свои отдельно не тянет —
  // блок в одного переводчика всё равно нишевой.
  let hourlyCells: HeatmapCell[] = [];
  if (!isAdmin) {
    try {
      const { data } = await supabase.rpc('translator_hourly_heatmap', {
        p_translator: user.id,
        p_days: 30,
      });
      if (Array.isArray(data)) {
        hourlyCells = (data as Array<{ dow: number; hour: number; reads: number }>).map(
          (c) => ({ dow: c.dow, hour: c.hour, reads: c.reads })
        );
      }
    } catch {
      // миграция 043 не накачена
    }
  }

  return (
    <main className="container admin-page admin-page--wide">
      <div className="admin-breadcrumbs">
        <Link href="/admin">Админка</Link>
        <span>/</span>
        <span>Аналитика</span>
      </div>

      <header className="admin-head">
        <div>
          <h1>Аналитика</h1>
          <p className="admin-head-sub">
            Как себя чувствуют твои новеллы и переводы.
          </p>
        </div>

        {/* Переключатель периода */}
        <div className="filter-pills">
          {VALID_PERIODS.map((p) => (
            <Link
              key={p}
              href={p === 7 ? '/admin/analytics' : `/admin/analytics?period=${p}`}
              className={`filter-pill${period === p ? ' active' : ''}`}
            >
              {PERIOD_LABELS[p]}
            </Link>
          ))}
        </div>
      </header>

      {/* Исторический блок «К выплате» больше не рендерится после
          перехода на per-translator кошельки (мигр. 045). Chaptify не
          держит деньги и не выплачивает переводчику — платёж идёт
          напрямую от читателя. Оставили pendingPayout-пересчёт в
          коде на случай аналитики, но вытянули как справочный статус. */}
      {pendingPayout && pendingPayout.chapterCount > 0 && (
        <div className="pending-payout" style={{ background: 'var(--bg-soft)' }}>
          <div className="pending-payout-head">
            <span className="pending-payout-emoji" aria-hidden="true">📘</span>
            <div>
              <div className="pending-payout-label">Твои продажи за период</div>
              <div className="pending-payout-amount" style={{ fontSize: 22 }}>
                {pendingPayout.chapterCount.toLocaleString('ru-RU')}{' '}
                {plural(pendingPayout.chapterCount, 'глава', 'главы', 'глав')}{' '}
                куплено
              </div>
              <div className="pending-payout-sub">
                {pendingPayout.uniqueBuyers}{' '}
                {plural(
                  pendingPayout.uniqueBuyers,
                  'читатель',
                  'читателя',
                  'читателей'
                )}{' '}
                открыли главы монетами. Монеты они получили, заплатив
                тебе напрямую — chaptify в расчётах не участвует.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Основные метрики */}
      <div className="period-cards">
        <PeriodCard
          label="Глав выпущено"
          value={totalChaptersPeriod}
          prev={totalChaptersPrev}
          hint={periodLabel}
        />
        <PeriodCard
          label="Покупок глав"
          value={totalPurchasesPeriod}
          prev={totalPurchasesPrev}
          hint={periodLabel}
        />
        <PeriodCard
          label="Монет заработано"
          value={coinsEarnedPeriod}
          prev={coinsEarnedPrev}
          hint={periodLabel}
        />
        <PeriodCard
          label="Новых подписок"
          value={newSubsPeriod}
          prev={newSubsPrev}
          hint={`активных сейчас: ${activeSubsCount}`}
        />
      </div>

      {/* Киллер-фича #2: автоматические находки */}
      <TopMoments moments={moments} />

      {/* Топ читателей — кто больше всех занёс монет переводчику */}
      {topSupporters.length > 0 && (
        <TopSupporters
          supporters={topSupporters}
          periodLabel={PERIOD_LABELS[period]}
        />
      )}

      {/* Киллер-фича #3: тепловая карта по новеллам + воронка drop-off */}
      <NovelsTable novels={novelMetrics} periodLabel={PERIOD_LABELS[period]} />

      {/* Когда публиковать — часовая heatmap читателей */}
      {!isAdmin && hourlyCells.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <HourlyHeatmap cells={hourlyCells} />
        </section>
      )}

      {/* Подсказка про данные */}
      <p style={{ color: 'var(--ink-mute)', fontSize: 12, marginTop: 16 }}>
        «Монеты заработаны» — сумма покупок глав за период (каждая — в минус
        читателю, в плюс тебе). Выплата зависит от правил платформы.
      </p>
    </main>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
