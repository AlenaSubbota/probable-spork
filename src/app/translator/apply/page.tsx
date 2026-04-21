import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import TranslatorApplyForm from './TranslatorApplyForm';

export default async function TranslatorApplyPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Если уже переводчик/админ — перекидываем в админку
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.role === 'translator' || profile?.role === 'admin') {
    redirect('/admin');
  }

  // Есть ли активная заявка
  const { data: existing } = await supabase
    .from('translator_applications')
    .select('id, status, motivation, reviewer_note, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <main className="container section" style={{ maxWidth: 720 }}>
      <h1 style={{ fontFamily: 'var(--font-serif)', marginBottom: 6 }}>
        Стать переводчиком
      </h1>
      <p style={{ color: 'var(--ink-mute)', marginBottom: 28 }}>
        Chaptify — это площадка для переводчиков. После одобрения заявки ты
        сможешь добавлять свои новеллы и главы, принимать подписки и продавать
        главы штучно за монетки.
      </p>

      {existing?.status === 'pending' && (
        <div className="card" style={{ background: 'var(--accent-wash)' }}>
          <strong>Заявка на рассмотрении.</strong>{' '}
          <span style={{ color: 'var(--ink-soft)' }}>
            Она отправлена {new Date(existing.created_at).toLocaleDateString('ru-RU')}. Мы
            напишем в личку, как примем решение.
          </span>
        </div>
      )}

      {existing?.status === 'rejected' && (
        <div className="card" style={{ background: '#F0DCD5' }}>
          <strong>Предыдущая заявка отклонена.</strong>
          {existing.reviewer_note && (
            <div style={{ color: 'var(--ink-soft)', marginTop: 6 }}>
              Комментарий: {existing.reviewer_note}
            </div>
          )}
          <div style={{ marginTop: 10 }}>Можно отправить новую, учтя замечания.</div>
        </div>
      )}

      {existing?.status !== 'pending' && <TranslatorApplyForm />}
    </main>
  );
}
