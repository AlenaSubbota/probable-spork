import Link from 'next/link';
import { createClient } from '@/utils/supabase/server';

interface TeamRow {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  member_count: number | null;
  novel_count: number | null;
  owner_display_name: string | null;
  owner_user_name: string | null;
}

export const metadata = { title: 'Команды переводчиков — Chaptify' };

// Каталог команд: чтобы читатель мог найти знакомую команду по имени и
// одним кликом отфильтровать каталог по их новеллам. Также служит точкой
// входа для тех, кто пришёл по «бренду команды», а не «по жанру».
export default async function TeamsIndexPage() {
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from('team_view')
    .select(
      'id, slug, name, description, avatar_url, banner_url, member_count, novel_count, owner_display_name, owner_user_name'
    )
    .eq('is_archived', false)
    .order('novel_count', { ascending: false, nullsFirst: false })
    .order('member_count', { ascending: false, nullsFirst: false })
    .limit(120);

  const teams = ((rows ?? []) as TeamRow[]).filter(
    // Скрываем пустые-пустые команды (без новелл и без членов кроме лидера)
    // — они засоряют ленту, а ничего полезного читателю не дают.
    (t) => (t.novel_count ?? 0) > 0 || (t.member_count ?? 0) > 1
  );

  return (
    <main className="container teams-index-page">
      <div className="admin-breadcrumbs">
        <Link href="/catalog">Каталог</Link>
        <span>/</span>
        <span>Команды</span>
      </div>

      <header className="teams-index-hero">
        <span className="pm-hero-eyebrow">🪶 Команды</span>
        <h1 className="teams-index-title">Команды переводчиков</h1>
        <p className="teams-index-sub">
          У каждой команды свой почерк: жанры, темп выпуска, общая
          интонация. Зайди в команду — увидишь всех участников, как с ней
          связаться и как поддержать одной кнопкой.
        </p>
      </header>

      {teams.length === 0 ? (
        <div className="empty-state">
          <p>Пока ни одной команды нет.</p>
        </div>
      ) : (
        <div className="teams-index-grid">
          {teams.map((t) => (
            // Карточка-обёртка — НЕ <Link>, чтобы внутри спокойно жили
            // две независимые ссылки (Next 16 запрещает вложенные <Link>).
            // Основной клик-таргет — overlay-Link, поверх него поднимаются
            // только actions с z-index.
            <article key={t.id} className="teams-index-card">
              <Link
                href={`/team/${t.slug}`}
                className="teams-index-card-overlay"
                aria-label={`Открыть команду ${t.name}`}
              />
              <div
                className="teams-index-card-banner"
                style={
                  t.banner_url
                    ? { backgroundImage: `url(${t.banner_url})` }
                    : undefined
                }
                aria-hidden="true"
              />
              <div className="teams-index-card-body">
                <div className="teams-index-card-avatar" aria-hidden="true">
                  {t.avatar_url ? (
                    <img src={t.avatar_url} alt="" />
                  ) : (
                    <span>{t.name.slice(0, 1).toUpperCase()}</span>
                  )}
                </div>
                <div className="teams-index-card-text">
                  <div className="teams-index-card-name">{t.name}</div>
                  {t.description && (
                    <div className="teams-index-card-desc">{t.description}</div>
                  )}
                  <div className="teams-index-card-meta">
                    <strong>{t.novel_count ?? 0}</strong>{' '}
                    {pluralNovels(t.novel_count ?? 0)}
                    <span aria-hidden="true">·</span>
                    <strong>{t.member_count ?? 0}</strong>{' '}
                    {pluralMembers(t.member_count ?? 0)}
                  </div>
                </div>
              </div>
              <div className="teams-index-card-actions">
                <span className="teams-index-card-cta">Открыть →</span>
                <Link
                  href={`/catalog?team=${t.slug}`}
                  className="teams-index-card-filter"
                >
                  В каталоге
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
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
