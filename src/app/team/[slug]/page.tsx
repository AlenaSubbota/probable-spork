import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import {
  fetchTeamBySlug,
  fetchTeamMembers,
  memberDisplayName,
  memberProfileHref,
  TEAM_ROLE_LABELS,
  type TeamMemberRow,
} from '@/lib/team';
import { getCoverUrl } from '@/lib/format';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  return { title: `Команда ${slug} — Chaptify` };
}

export default async function TeamPage({ params }: PageProps) {
  const { slug } = await params;
  const supabase = await createClient();

  const team = await fetchTeamBySlug(supabase, slug);
  if (!team) notFound();

  const [members, novelsRes, paymentMethodsRes] = await Promise.all([
    fetchTeamMembers(supabase, team.id),
    supabase
      .from('novels_view')
      .select('id, firebase_id, title, cover_url, chapter_count, is_completed')
      .eq('team_id', team.id)
      .order('latest_chapter_published_at', { ascending: false, nullsFirst: false })
      .limit(48),
    // Способы оплаты — лидера команды. Это и есть «куда донатить
    // команде»: один счёт, чтобы читателю не приходилось выбирать
    // среди 20 человек.
    supabase
      .from('translator_payment_methods')
      .select('id, provider, url, instructions')
      .eq('translator_id', team.owner_id)
      .eq('enabled', true)
      .order('sort_order', { ascending: true }),
  ]);

  const novels = (novelsRes.data ?? []) as Array<{
    id: number;
    firebase_id: string;
    title: string;
    cover_url: string | null;
    chapter_count: number | null;
    is_completed: boolean | null;
  }>;
  const paymentMethods = (paymentMethodsRes.data ?? []) as Array<{
    id: number;
    provider: 'boosty' | 'tribute' | 'vk_donut' | 'patreon' | 'other';
    url: string;
    instructions: string | null;
  }>;

  // Лидер — отдельно сверху, остальные участники — в гриде ниже
  const lead = members.find((m) => m.role === 'lead') ?? null;
  const otherMembers = members.filter((m) => m.role !== 'lead');

  return (
    <main className="container team-page">
      <div className="admin-breadcrumbs">
        <Link href="/catalog">Каталог</Link>
        <span>/</span>
        <span>Команды</span>
        <span>/</span>
        <span>{team.name}</span>
      </div>

      <header className="team-hero">
        {team.banner_url && (
          <div
            className="team-hero-banner"
            style={{ backgroundImage: `url(${team.banner_url})` }}
            aria-hidden="true"
          />
        )}
        <div className="team-hero-body">
          <div className="team-hero-avatar" aria-hidden={team.avatar_url ? 'false' : 'true'}>
            {team.avatar_url ? (
              <img src={team.avatar_url} alt={team.name} />
            ) : (
              <span className="team-hero-avatar-fallback">
                {team.name.slice(0, 1).toUpperCase()}
              </span>
            )}
          </div>
          <div className="team-hero-text">
            <span className="team-hero-eyebrow">Команда переводчиков</span>
            <h1 className="team-hero-title">{team.name}</h1>
            {team.description && (
              <p className="team-hero-desc">{team.description}</p>
            )}
            <div className="team-hero-meta">
              <span className="team-hero-meta-item">
                <strong>{team.member_count ?? members.length}</strong>{' '}
                {pluralMembers(team.member_count ?? members.length)}
              </span>
              <span className="team-hero-meta-sep" aria-hidden="true">·</span>
              <span className="team-hero-meta-item">
                <strong>{team.novel_count ?? novels.length}</strong>{' '}
                {pluralNovels(team.novel_count ?? novels.length)}
              </span>
              {lead?.translator_slug && (
                <>
                  <span className="team-hero-meta-sep" aria-hidden="true">·</span>
                  <span className="team-hero-meta-item">
                    лидер{' '}
                    <Link
                      href={`/t/${lead.translator_slug}`}
                      className="team-hero-lead-link"
                    >
                      {memberDisplayName(lead)}
                    </Link>
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* «Поддержать команду» — единый блок донатов. Решает «кому из 20
          донатить»: счёт один, лидер делит сам. Если у лидера ничего не
          подключено — блок не рисуем (ничего не куда платить). */}
      {paymentMethods.length > 0 && (
        <section className="team-support">
          <h2 className="team-section-title">Поддержать команду</h2>
          <p className="team-support-sub">
            Деньги идут на единый счёт команды (Boosty / Tribute / карта{' '}
            <strong>{lead ? memberDisplayName(lead) : 'лидера'}</strong>),
            лидер делит между участниками сам. Chaptify комиссию не берёт.
          </p>
          <div className="team-support-grid">
            {paymentMethods.map((pm) => (
              <a
                key={pm.id}
                href={pm.url}
                target="_blank"
                rel="noreferrer noopener"
                className="team-support-card"
              >
                <div className="team-support-card-icon" aria-hidden="true">
                  {providerIcon(pm.provider)}
                </div>
                <div className="team-support-card-body">
                  <div className="team-support-card-name">
                    {providerLabel(pm.provider)}
                  </div>
                  {pm.instructions && (
                    <div className="team-support-card-hint">
                      {pm.instructions}
                    </div>
                  )}
                </div>
                <span className="team-support-card-arrow" aria-hidden="true">↗</span>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Участники: один лидер сверху, остальные — карточки в гриде. */}
      <section className="team-members">
        <h2 className="team-section-title">
          Участники <small className="team-section-count">({members.length})</small>
        </h2>
        {lead && (
          <div className="team-member-card team-member-card--lead">
            <MemberAvatar member={lead} size={72} />
            <div className="team-member-body">
              <Link href={memberProfileHref(lead)} className="team-member-name">
                {memberDisplayName(lead)}
              </Link>
              <div className="team-member-role">{TEAM_ROLE_LABELS[lead.role]}</div>
              {lead.translator_about && (
                <p className="team-member-about">{lead.translator_about}</p>
              )}
            </div>
          </div>
        )}
        {otherMembers.length > 0 && (
          <div className="team-members-grid">
            {otherMembers.map((m) => (
              <Link
                key={m.id}
                href={memberProfileHref(m)}
                className="team-member-card"
              >
                <MemberAvatar member={m} size={52} />
                <div className="team-member-body">
                  <div className="team-member-name">{memberDisplayName(m)}</div>
                  <div className="team-member-role">{TEAM_ROLE_LABELS[m.role]}</div>
                  {m.note && <div className="team-member-note">{m.note}</div>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Новеллы команды */}
      {novels.length > 0 && (
        <section className="team-novels">
          <h2 className="team-section-title">
            Новеллы <small className="team-section-count">({novels.length})</small>
          </h2>
          <div className="team-novels-grid">
            {novels.map((n) => {
              const cover = getCoverUrl(n.cover_url);
              return (
                <Link
                  key={n.id}
                  href={`/novel/${n.firebase_id}`}
                  className="team-novel-card"
                >
                  <div className="team-novel-cover">
                    {cover ? (
                      <img src={cover} alt={n.title} />
                    ) : (
                      <div className="team-novel-cover-fallback">
                        {n.title.slice(0, 12)}
                      </div>
                    )}
                    {n.is_completed && (
                      <span className="team-novel-flag">FIN</span>
                    )}
                  </div>
                  <div className="team-novel-title">{n.title}</div>
                  {typeof n.chapter_count === 'number' && (
                    <div className="team-novel-meta">
                      {n.chapter_count} {pluralChapters(n.chapter_count)}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}

function MemberAvatar({ member, size }: { member: TeamMemberRow; size: number }) {
  if (member.avatar_url) {
    return (
      <span className="team-member-avatar" style={{ width: size, height: size }}>
        <img src={member.avatar_url} alt="" />
      </span>
    );
  }
  return (
    <span
      className="team-member-avatar team-member-avatar--fallback"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {memberDisplayName(member).slice(0, 1).toUpperCase()}
    </span>
  );
}

function providerIcon(p: string): string {
  switch (p) {
    case 'boosty':   return '💛';
    case 'tribute':  return '💰';
    case 'vk_donut': return '🟦';
    case 'patreon':  return '🧡';
    default:         return '✨';
  }
}
function providerLabel(p: string): string {
  switch (p) {
    case 'boosty':   return 'Boosty';
    case 'tribute':  return 'Tribute';
    case 'vk_donut': return 'VK Donut';
    case 'patreon':  return 'Patreon';
    default:         return 'Другое';
  }
}

function pluralMembers(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'участник';
  if ([2, 3, 4].includes(m10) && ![12, 13, 14].includes(m100)) return 'участника';
  return 'участников';
}
function pluralNovels(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'новелла';
  if ([2, 3, 4].includes(m10) && ![12, 13, 14].includes(m100)) return 'новеллы';
  return 'новелл';
}
function pluralChapters(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'глава';
  if ([2, 3, 4].includes(m10) && ![12, 13, 14].includes(m100)) return 'главы';
  return 'глав';
}
