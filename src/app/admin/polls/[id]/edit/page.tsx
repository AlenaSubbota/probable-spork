import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import PollForm, {
  type PollFormValues,
  type PollOptionFormValue,
} from '@/components/admin/PollForm';

export const metadata = { title: 'Редактирование опроса — Chaptify' };

export default async function EditPollPage(
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  const pollId = Number(id);
  if (!Number.isFinite(pollId)) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  const p = profile as { role?: string; is_admin?: boolean } | null;
  const isAdmin = p?.is_admin === true || p?.role === 'admin';
  if (!isAdmin) redirect('/admin');

  const { data: poll } = await supabase
    .from('polls')
    .select('id, title, description, is_active, ends_at')
    .eq('id', pollId)
    .maybeSingle();
  if (!poll) notFound();

  const { data: options } = await supabase
    .from('poll_options')
    .select('id, title, description, cover_url, external_link, sort_order')
    .eq('poll_id', pollId)
    .order('sort_order', { ascending: true });

  const initial: PollFormValues = {
    id: poll.id,
    title: poll.title ?? '',
    description: poll.description ?? '',
    is_active: !!poll.is_active,
    ends_at: poll.ends_at,
    options: (options ?? []).map<PollOptionFormValue>((o, i) => ({
      id: o.id,
      title: o.title ?? '',
      description: o.description ?? '',
      cover_url: o.cover_url ?? '',
      external_link: o.external_link ?? '',
      sort_order: o.sort_order ?? i,
    })),
  };
  if (initial.options.length < 2) {
    while (initial.options.length < 2) {
      initial.options.push({
        title: '',
        description: '',
        cover_url: '',
        external_link: '',
        sort_order: initial.options.length,
      });
    }
  }

  return (
    <main className="container admin-page">
      <div className="admin-breadcrumbs">
        <Link href="/admin">Админка</Link>
        <span>/</span>
        <Link href="/admin/polls">Опросы</Link>
        <span>/</span>
        <span>{poll.title}</span>
      </div>

      <h1>Редактирование опроса</h1>
      <p style={{ color: 'var(--ink-mute)', marginBottom: 24 }}>
        Менять варианты можно даже после того, как люди проголосовали, — голоса
        останутся привязаны к тем вариантам, что есть сейчас.
      </p>

      <PollForm mode="edit" initial={initial} />
    </main>
  );
}
