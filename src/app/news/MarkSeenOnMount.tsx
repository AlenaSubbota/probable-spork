'use client';

import { useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';

interface Props {
  maxId: number;
}

// Клиентский компонент, который разово помечает новости прочитанными (через RPC).
// После мигрирующего визита на /news счётчик непрочитанных в шапке сбрасывается.
export default function MarkSeenOnMount({ maxId }: Props) {
  useEffect(() => {
    if (!maxId) return;
    const supabase = createClient();
    supabase.rpc('mark_news_seen', { p_max_id: maxId }).then(() => {}, () => {});
  }, [maxId]);
  return null;
}
