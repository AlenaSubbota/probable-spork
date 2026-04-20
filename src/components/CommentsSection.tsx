'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';

export default function CommentsSection({ chapterId }: { chapterId: string }) {
  const supabase = createClient();
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(true);

  // Загрузка комментариев
  const fetchComments = async () => {
    const { data, error } = await supabase
      .from('comments')
      .select(`
        id,
        content,
        created_at,
        profiles (
          username,
          avatar_url
        )
      `)
      .eq('chapter_id', chapterId)
      .order('created_at', { ascending: true });

    if (!error) setComments(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchComments(); }, [chapterId]);

  // Отправка нового комментария
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      alert('Войдите, чтобы оставить комментарий');
      return;
    }

    const { error } = await supabase
      .from('comments')
      .insert({
        chapter_id: chapterId,
        user_id: user.id,
        content: newComment
      });

    if (!error) {
      setNewComment('');
      fetchComments();
    }
  };

  if (loading) return <div>Загрузка комментариев...</div>;

  return (
    <section className="comments-area">
      <h3 style={{ marginBottom: '24px' }}>Обсуждение ({comments.length})</h3>

      <form onSubmit={handleSubmit} style={{ marginBottom: '40px' }}>
        <textarea 
          className="card"
          style={{ width: '100%', minHeight: '100px', marginBottom: '12px', padding: '16px', border: '1px solid var(--border)' }}
          placeholder="Написать комментарий..."
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
        />
        <button type="submit" className="btn btn-primary">Отправить</button>
      </form>

      <div className="comments-list" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {comments.map((comment) => (
          <div key={comment.id} style={{ display: 'flex', gap: '16px' }}>
            <div className="mini-cover" style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--accent-wash)', flexShrink: 0 }}>
              {comment.profiles?.avatar_url && <img src={comment.profiles.avatar_url} style={{ borderRadius: '50%' }} />}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <strong style={{ fontSize: '14px' }}>{comment.profiles?.username || 'Аноним'}</strong>
                <span style={{ fontSize: '12px', color: 'var(--ink-mute)' }}>
                  {new Date(comment.created_at).toLocaleDateString()}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '15px', color: 'var(--ink-soft)' }}>{comment.content}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}