import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/utils/supabase/server';

// Скачивание EPUB для новеллы.
// Источник: novels.epub_path. Переводчик мог положить туда либо полный URL
// (внешний Google Drive / Dropbox / www.something.ru), либо относительный
// path внутри бакета 'epub' в Supabase Storage.
// Если path — redirect на короткоживущий signed URL; если полный URL —
// redirect на него как есть.
// Недоступно для неопубликованных новелл (исключая переводчика и админа).

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: novel } = await supabase
    .from('novels')
    .select('id, title, firebase_id, epub_path, moderation_status, translator_id')
    .eq('firebase_id', id)
    .maybeSingle();

  if (!novel) {
    return new NextResponse('Новелла не найдена', { status: 404 });
  }
  if (!novel.epub_path) {
    return new NextResponse('EPUB пока не загружен', { status: 404 });
  }

  // Проверка доступа для неопубликованных
  if (novel.moderation_status !== 'published') {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new NextResponse('Нужен вход', { status: 401 });
    const { data: viewer } = await supabase
      .from('profiles')
      .select('role, is_admin')
      .eq('id', user.id)
      .maybeSingle();
    const v = viewer as { role?: string; is_admin?: boolean } | null;
    const isAdmin = v?.is_admin === true || v?.role === 'admin';
    if (!isAdmin && novel.translator_id !== user.id) {
      return new NextResponse('Недоступно', { status: 403 });
    }
  }

  const path = String(novel.epub_path).trim();
  if (/^https?:\/\//i.test(path)) {
    return NextResponse.redirect(path);
  }

  // Относительный путь — signed URL на 60 секунд.
  // Bucket по умолчанию — 'epub'; если ваш лежит под другим именем, можно
  // положить префикс как 'bucket/path' и мы это разберём.
  let bucket = 'epub';
  let key = path.replace(/^\/+/, '');
  const slashIdx = key.indexOf('/');
  if (slashIdx > 0 && ['epub', 'chapter_content', 'covers'].includes(key.slice(0, slashIdx))) {
    bucket = key.slice(0, slashIdx);
    key = key.slice(slashIdx + 1);
  }

  const { data: signed, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(key, 60, {
      download: `${novel.title}.epub`,
    });

  if (error || !signed?.signedUrl) {
    return new NextResponse(
      'Не удалось создать ссылку на файл: ' + (error?.message ?? 'unknown'),
      { status: 500 }
    );
  }

  return NextResponse.redirect(signed.signedUrl);
}
