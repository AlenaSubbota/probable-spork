import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import ScheduleEditor, {
  type ScheduleSlot,
} from '@/components/admin/ScheduleEditor';

export const metadata = { title: 'Расписание · Админка — Chaptify' };

export default async function AdminSchedulePage() {
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
  const isTranslator = isAdmin || p?.role === 'translator';
  if (!isTranslator) redirect('/translator/apply');

  // Слоты расписания + данные новелл одним махом (через join в JS, чтобы
  // не плодить views ради одной фичи)
  const { data: rawSlots } = await supabase
    .from('translator_schedule')
    .select('id, novel_id, day_of_week, time_of_day, note')
    .eq('translator_id', user.id)
    .order('day_of_week', { ascending: true })
    .order('sort_order', { ascending: true });

  const novelIds = Array.from(
    new Set((rawSlots ?? []).map((s) => s.novel_id))
  );

  const novelMap = new Map<
    number,
    { title: string; firebase_id: string; cover_url: string | null }
  >();
  if (novelIds.length > 0) {
    const { data: novelsData } = await supabase
      .from('novels')
      .select('id, title, firebase_id, cover_url')
      .in('id', novelIds);
    for (const n of novelsData ?? []) {
      novelMap.set(n.id, {
        title: n.title,
        firebase_id: n.firebase_id,
        cover_url: n.cover_url,
      });
    }
  }

  const slots: ScheduleSlot[] = (rawSlots ?? []).flatMap((s) => {
    const nv = novelMap.get(s.novel_id);
    if (!nv) return [];
    return [
      {
        id: s.id,
        novel_id: s.novel_id,
        day_of_week: s.day_of_week,
        time_of_day: s.time_of_day,
        note: s.note,
        novel_title: nv.title,
        novel_firebase_id: nv.firebase_id,
        novel_cover_url: nv.cover_url,
      },
    ];
  });

  // Быстрые пики — свои новеллы (опубликованные и черновики в т.ч.)
  const { data: myNovelsRaw } = await supabase
    .from('novels')
    .select('id, title, firebase_id, cover_url')
    .eq('translator_id', user.id)
    .order('title', { ascending: true })
    .limit(24);

  const myNovels = (myNovelsRaw ?? []).map((n) => ({
    id: n.id,
    title: n.title,
    firebase_id: n.firebase_id,
    cover_url: n.cover_url,
  }));

  return (
    <main className="container admin-page">
      <div className="admin-breadcrumbs">
        <Link href="/admin">Админка</Link>
        <span>/</span>
        <span>Расписание</span>
      </div>

      <header className="admin-head">
        <div>
          <h1>Расписание</h1>
          <p className="admin-head-sub">
            Поставь новеллы по дням — читатели увидят этот график в твоём
            профиле и будут знать, когда ждать новых глав. Одна и та же
            новелла может стоять на нескольких днях (Пн/Ср/Пт).
          </p>
        </div>
      </header>

      <ScheduleEditor
        translatorId={user.id}
        initialSlots={slots}
        myNovels={myNovels}
      />
    </main>
  );
}
