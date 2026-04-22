import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { buildEpub } from '@/lib/epub';

// Скачивание EPUB для новеллы.
//
// Два режима:
//   1. Если в novels.epub_path лежит строка → поведение как было раньше:
//      full URL → redirect, path в bucket → signed URL.
//   2. По умолчанию (или при ?gen=1) → собираем EPUB на лету из БД с
//      учётом уровня доступа текущего пользователя:
//        - аноним или нет подписки/покупок → только бесплатные главы
//        - есть активная подписка на переводчика → все главы
//        - есть покупки отдельных платных глав → бесплатные + купленные

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const supabase = await createClient();

  const { data: novel } = await supabase
    .from('novels')
    .select(
      'id, title, firebase_id, epub_path, moderation_status, translator_id, cover_url, author, external_translator_name'
    )
    .eq('firebase_id', id)
    .maybeSingle();

  if (!novel) {
    return new NextResponse('Новелла не найдена', { status: 404 });
  }

  // Неопубликованные — только владельцу/админу
  const { data: { user } } = await supabase.auth.getUser();
  if (novel.moderation_status !== 'published') {
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

  const forceGenerate = req.nextUrl.searchParams.get('gen') === '1';

  // Режим 1: готовый файл из novels.epub_path
  if (novel.epub_path && !forceGenerate) {
    const path = String(novel.epub_path).trim();
    if (/^https?:\/\//i.test(path)) {
      return NextResponse.redirect(path);
    }
    let bucket = 'epub';
    let key = path.replace(/^\/+/, '');
    const slashIdx = key.indexOf('/');
    if (
      slashIdx > 0 &&
      ['epub', 'chapter_content', 'covers'].includes(key.slice(0, slashIdx))
    ) {
      bucket = key.slice(0, slashIdx);
      key = key.slice(slashIdx + 1);
    }
    const { data: signed, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(key, 60, { download: `${novel.title}.epub` });
    if (!error && signed?.signedUrl) {
      return NextResponse.redirect(signed.signedUrl);
    }
    // если не получилось — падаем в on-demand
  }

  // Режим 2: on-demand сборка по уровню доступа
  const { data: allChapters } = await supabase
    .from('chapters')
    .select('chapter_number, is_paid, content_path, published_at')
    .eq('novel_id', novel.id)
    .not('published_at', 'is', null)
    .lte('published_at', new Date().toISOString())
    .order('chapter_number', { ascending: true });

  if (!allChapters || allChapters.length === 0) {
    return new NextResponse('Нет опубликованных глав', { status: 404 });
  }

  // Определяем доступ пользователя
  let hasSubscription = false;
  const purchasedSet = new Set<number>();
  if (user && novel.translator_id) {
    const [{ data: subs }, { data: purchased }] = await Promise.all([
      supabase
        .from('subscriptions')
        .select('id')
        .eq('user_id', user.id)
        .eq('translator_id', novel.translator_id)
        .eq('status', 'active')
        .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
        .limit(1),
      supabase.rpc('my_purchased_chapters', { p_novel: novel.id }).then(
        (r) => r,
        () => ({ data: null })
      ),
    ]);
    hasSubscription = (subs?.length ?? 0) > 0;
    if (Array.isArray(purchased)) {
      for (const n of purchased as number[]) purchasedSet.add(n);
    }
  }

  // Владелец / админ получают все главы независимо от прав
  let isOwnerOrAdmin = false;
  if (user) {
    if (novel.translator_id === user.id) {
      isOwnerOrAdmin = true;
    } else {
      const { data: viewer } = await supabase
        .from('profiles')
        .select('role, is_admin')
        .eq('id', user.id)
        .maybeSingle();
      const v = viewer as { role?: string; is_admin?: boolean } | null;
      if (v?.is_admin === true || v?.role === 'admin') isOwnerOrAdmin = true;
    }
  }

  const accessibleChapters = allChapters.filter((c) => {
    if (isOwnerOrAdmin) return true;
    if (!c.is_paid) return true;
    if (hasSubscription) return true;
    if (purchasedSet.has(c.chapter_number)) return true;
    return false;
  });

  if (accessibleChapters.length === 0) {
    return new NextResponse(
      'У тебя нет доступных глав. Оформи подписку или купи главу, чтобы получить EPUB.',
      { status: 403 }
    );
  }

  const tierLabel = isOwnerOrAdmin
    ? 'Все главы (переводчик)'
    : hasSubscription
      ? 'Все главы (подписка)'
      : purchasedSet.size > 0
        ? `Бесплатные + ${purchasedSet.size} купленных`
        : 'Только бесплатные главы';

  // Качаем html-файлы глав из storage параллельно (батчами, чтобы не уронить)
  const CONCURRENCY = 8;
  const fetched: Array<{ number: number; html: string }> = [];
  for (let i = 0; i < accessibleChapters.length; i += CONCURRENCY) {
    const slice = accessibleChapters.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      slice.map(async (c) => {
        if (!c.content_path) {
          return { number: c.chapter_number, html: '<p><em>Текст отсутствует.</em></p>' };
        }
        const { data: file } = await supabase.storage
          .from('chapter_content')
          .download(c.content_path);
        if (!file) {
          return { number: c.chapter_number, html: '<p><em>Не удалось загрузить.</em></p>' };
        }
        const html = await file.text();
        return { number: c.chapter_number, html };
      })
    );
    fetched.push(...results);
  }

  // Обложка — если cover_url это http(s), скачаем.
  let coverBytes: Uint8Array | null = null;
  let coverContentType: string | null = null;
  if (novel.cover_url) {
    try {
      const coverUrl = /^https?:\/\//i.test(novel.cover_url)
        ? novel.cover_url
        : null;
      if (coverUrl) {
        const res = await fetch(coverUrl);
        if (res.ok) {
          const ct = res.headers.get('content-type') ?? 'image/jpeg';
          if (ct.startsWith('image/')) {
            const buf = new Uint8Array(await res.arrayBuffer());
            coverBytes = buf;
            coverContentType = ct;
          }
        }
      }
    } catch {
      // обложка — нон-критично
    }
  }

  // Автор для метаданных — либо registered translator_display_name / user_name,
  // либо external_translator_name, либо novel.author (legacy)
  let authorName = novel.author ?? 'Неизвестно';
  if (novel.translator_id) {
    const { data: t } = await supabase
      .from('profiles')
      .select('translator_display_name, user_name')
      .eq('id', novel.translator_id)
      .maybeSingle();
    const tp = t as {
      translator_display_name?: string | null;
      user_name?: string | null;
    } | null;
    authorName =
      tp?.translator_display_name || tp?.user_name || authorName;
  } else if (novel.external_translator_name) {
    authorName = novel.external_translator_name;
  }

  const epub = await buildEpub({
    novelTitle: novel.title,
    authorName,
    coverBytes,
    coverContentType,
    language: 'ru',
    identifier: `${novel.firebase_id}:${
      isOwnerOrAdmin ? 'all' : hasSubscription ? 'sub' : purchasedSet.size > 0 ? `buy-${purchasedSet.size}` : 'free'
    }`,
    chapters: fetched.map((c) => ({
      number: c.number,
      title: `Глава ${c.number}`,
      html: c.html,
    })),
    tierLabel,
  });

  const safeTitle = novel.title.replace(/[^\p{L}\p{N}\s-]/gu, '').trim().slice(0, 80);
  const filename = `${safeTitle || novel.firebase_id}.epub`;

  return new NextResponse(epub as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/epub+zip',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'private, max-age=60',
      'X-Epub-Tier': isOwnerOrAdmin ? 'all' : hasSubscription ? 'sub' : purchasedSet.size > 0 ? 'buy' : 'free',
      'X-Epub-Chapters': String(accessibleChapters.length),
    },
  });
}
