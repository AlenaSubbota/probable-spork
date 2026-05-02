import { cache } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

// Найти новеллу по строке из URL `[id]`. URL может содержать:
//   1. firebase_id — каноничный chaptify-формат (строка из tene-legacy
//      или slug);
//   2. numeric novels.id — формат tene-бота уведомлений (он генерит
//      `/novel/<numeric>/chapter/0#comment-N`).
//
// Возвращаем первый матч. firebase_id проверяем первым (это самый
// частый случай), числовой id — fallback. Кэшируем через React.cache,
// чтобы NovelHero и сама подстраница (page.tsx) не делали два одинаковых
// запроса в рамках одного render'а.
export const findNovelByParam = cache(
  async (
    supabase: SupabaseClient,
    idOrFirebaseId: string,
    selectCols: string = '*',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<{ data: any | null }> => {
    // 1) firebase_id (строка).
    const byFb = await supabase
      .from('novels_view')
      .select(selectCols)
      .eq('firebase_id', idOrFirebaseId)
      .maybeSingle();
    if (byFb.data) return { data: byFb.data };

    // 2) numeric id — только если строка вообще похожа на число.
    if (/^\d+$/.test(idOrFirebaseId)) {
      const numId = parseInt(idOrFirebaseId, 10);
      if (Number.isFinite(numId)) {
        const byId = await supabase
          .from('novels_view')
          .select(selectCols)
          .eq('id', numId)
          .maybeSingle();
        if (byId.data) return { data: byId.data };
      }
    }

    return { data: null };
  }
);
