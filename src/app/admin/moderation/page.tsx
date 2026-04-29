import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import ModerationCard, {
  type ModerationNovel,
} from '@/components/admin/ModerationCard';
import ClaimCard, { type Claim } from '@/components/admin/ClaimCard';
import { cleanGenres } from '@/lib/format';

export const metadata = { title: 'Модерация · Админка — Chaptify' };

export default async function AdminModerationPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_admin')
    .eq('id', user.id)
    .maybeSingle();
  const p = profile as { role?: string; is_admin?: boolean } | null;
  const isAdmin = p?.is_admin === true || p?.role === 'admin';
  if (!isAdmin) redirect('/admin');

  const { data: pendingRaw } = await supabase
    .from('novels_view')
    .select(
      'id, firebase_id, title, cover_url, description, chapter_count, age_rating, genres, translator_id'
    )
    .eq('moderation_status', 'pending')
    .order('latest_chapter_published_at', { ascending: true, nullsFirst: true });

  // Подтягиваем отображаемые имена и slug переводчиков одним запросом
  const translatorIds = Array.from(
    new Set(
      (pendingRaw ?? [])
        .map((n) => n.translator_id)
        .filter((x): x is string => !!x)
    )
  );
  const translatorMap = new Map<
    string,
    { display: string | null; slug: string | null }
  >();
  if (translatorIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, translator_display_name, translator_slug, user_name')
      .in('id', translatorIds);
    for (const pr of profiles ?? []) {
      translatorMap.set(pr.id, {
        display: pr.translator_display_name ?? pr.user_name ?? null,
        slug: pr.translator_slug ?? pr.user_name ?? null,
      });
    }
  }

  const pending: ModerationNovel[] = (pendingRaw ?? []).map((n) => {
    const t = n.translator_id ? translatorMap.get(n.translator_id) : null;
    return {
      id: n.id,
      firebase_id: n.firebase_id,
      title: n.title,
      cover_url: n.cover_url,
      description: n.description,
      chapter_count: n.chapter_count,
      age_rating: n.age_rating,
      genres: cleanGenres(n.genres),
      translator_display_name: t?.display ?? null,
      translator_slug: t?.slug ?? null,
    };
  });

  // История недавних решений — последние 10 published/rejected с reviewed_at
  const { data: recentDecisions } = await supabase
    .from('novels_view')
    .select(
      'id, firebase_id, title, moderation_status, rejection_reason, reviewed_at'
    )
    .in('moderation_status', ['published', 'rejected'])
    .not('reviewed_at', 'is', null)
    .order('reviewed_at', { ascending: false })
    .limit(10);

  // Pending claims: «это моя работа»
  let claims: Claim[] = [];
  try {
    const { data: claimsRaw } = await supabase
      .from('novel_translator_claims')
      .select('id, novel_id, claimant_id, proof, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    const novelIds = Array.from(
      new Set((claimsRaw ?? []).map((c) => c.novel_id))
    );
    const claimantIds = Array.from(
      new Set((claimsRaw ?? []).map((c) => c.claimant_id))
    );
    const [{ data: novelsForClaims }, { data: claimantsForClaims }] =
      await Promise.all([
        novelIds.length > 0
          ? supabase
              .from('novels')
              .select('id, firebase_id, title, external_translator_name')
              .in('id', novelIds)
          : Promise.resolve({ data: [] }),
        claimantIds.length > 0
          ? supabase
              .from('profiles')
              .select('id, user_name, translator_display_name, translator_slug')
              .in('id', claimantIds)
          : Promise.resolve({ data: [] }),
      ]);
    const novelsMap = new Map(
      (novelsForClaims ?? []).map((n) => [n.id, n])
    );
    const claimantsMap = new Map(
      (claimantsForClaims ?? []).map((u) => [u.id, u])
    );
    claims = (claimsRaw ?? []).flatMap((c) => {
      const n = novelsMap.get(c.novel_id);
      const u = claimantsMap.get(c.claimant_id);
      if (!n) return [];
      return [
        {
          id: c.id,
          novel_id: c.novel_id,
          novel_firebase_id: n.firebase_id,
          novel_title: n.title,
          external_name: n.external_translator_name ?? null,
          claimant_id: c.claimant_id,
          claimant_name:
            (u as { translator_display_name?: string | null; user_name?: string | null } | undefined)
              ?.translator_display_name ||
            (u as { user_name?: string | null } | undefined)?.user_name ||
            'Пользователь',
          claimant_slug:
            (u as { translator_slug?: string | null; user_name?: string | null } | undefined)
              ?.translator_slug ||
            (u as { user_name?: string | null } | undefined)?.user_name ||
            null,
          proof: c.proof ?? null,
          created_at: c.created_at,
        },
      ];
    });
  } catch {
    // миграция 024 не накачена
  }

  return (
    <main className="container admin-page">
      <div className="admin-breadcrumbs">
        <Link href="/admin">Админка</Link>
        <span>/</span>
        <span>Модерация</span>
      </div>

      <header className="admin-head">
        <div>
          <h1>Модерация новелл</h1>
          <p className="admin-head-sub">
            Переводчик присылает новеллу → ты проверяешь → одобряешь или
            отклоняешь с причиной. Читатели видят только опубликованные.
          </p>
        </div>
      </header>

      {claims.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <div className="section-head">
            <h2>Заявки «Это моя работа»</h2>
            <span className="more" style={{ cursor: 'default' }}>
              {claims.length} шт.
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {claims.map((c) => (
              <ClaimCard key={c.id} claim={c} />
            ))}
          </div>
        </section>
      )}

      <section style={{ marginBottom: 32 }}>
        <div className="section-head">
          <h2>На модерации</h2>
          <span className="more" style={{ cursor: 'default' }}>
            {pending.length} шт.
          </span>
        </div>

        {pending.length === 0 ? (
          <div className="empty-state">
            <p>Очередь пуста — все присланные новеллы разобраны.</p>
            <Link href="/admin" className="btn btn-ghost">
              Назад в админку
            </Link>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {pending.map((n) => (
              <ModerationCard key={n.id} novel={n} />
            ))}
          </div>
        )}
      </section>

      {recentDecisions && recentDecisions.length > 0 && (
        <section>
          <div className="section-head">
            <h2>Последние решения</h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recentDecisions.map((r) => (
              <div
                key={r.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 14px',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  fontSize: 13,
                }}
              >
                <span
                  className={`mod-badge mod-badge--${
                    r.moderation_status === 'published' ? 'leaf' : 'rose'
                  }`}
                >
                  {r.moderation_status === 'published' ? 'Одобрено' : 'Отклонено'}
                </span>
                <Link
                  href={`/novel/${r.firebase_id}`}
                  style={{ fontWeight: 600 }}
                >
                  {r.title}
                </Link>
                {r.moderation_status === 'rejected' && r.rejection_reason && (
                  <span style={{ color: 'var(--ink-mute)' }}>
                    — {r.rejection_reason}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
