import Link from 'next/link';
import NovelForm from '@/components/admin/NovelForm';

export default function NewNovelPage() {
  return (
    <main className="container admin-page">
      <div className="admin-breadcrumbs">
        <Link href="/admin">Админка</Link>
        <span>/</span>
        <span>Новая новелла</span>
      </div>

      <h1>Новая новелла</h1>
      <p style={{ color: 'var(--ink-mute)', marginBottom: 24 }}>
        Заполни карточку новеллы. После сохранения откроется страница
        редактирования, откуда ты сможешь добавлять главы и глоссарий.
      </p>

      <NovelForm mode="create" />
    </main>
  );
}
