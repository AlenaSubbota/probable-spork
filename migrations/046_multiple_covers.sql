-- ============================================================
-- 046: несколько обложек у новеллы (covers jsonb)
--
-- Алёна: «Добавить возможность в новеллы добавлять несколько обложек.
-- В карточке — их листать».
--
-- Дизайн: оставляем novels.cover_url как «главная обложка» (tene.fun
-- продолжает её использовать). Новая колонка novels.covers jsonb —
-- массив строк-ссылок (дополнительные варианты). На странице новеллы и
-- в карточке каталога можно будет переключаться между ними.
--
-- Формат covers: `["abc.webp", "https://…/b.jpg", …]`. Тот же формат
-- что и cover_url (UUID-имя → public storage bucket 'covers', иначе
-- legacy путь).
--
-- Tene-safety: колонка jsonb с default NULL, tene не читает.
-- ============================================================

ALTER TABLE public.novels
  ADD COLUMN IF NOT EXISTS covers jsonb;

-- Пересоздаём novels_view, чтобы covers попали в публичное view.
-- CREATE OR REPLACE не даёт добавить новую колонку в середине — DROP+
-- CREATE безопаснее. Подписчики view не зависимы (чаптифай-only).
DROP VIEW IF EXISTS public.novels_view;

CREATE VIEW public.novels_view AS
 SELECT n.id,
    n.firebase_id,
    n.title,
    n.title_original,
    n.title_en,
    n.author,
    n.author_original,
    n.author_en,
    n.description,
    n.cover_url,
    n.covers,                     -- NEW: массив доп. обложек
    n.genres,
    n.latest_chapter_published_at,
    n.is_completed,
    n.epub_path,
    n.translator_id,
    n.external_translator_name,
    n.external_translator_url,
    n.external_translator_note,
    n.country,
    n.age_rating,
    n.translation_status,
    n.release_year,
    n.moderation_status,
    n.rejection_reason,
    n.reviewed_at,
    n.reviewer_id,
    n.external_links,
    COALESCE(s.average_rating, (0)::numeric) AS average_rating,
    COALESCE(s.rating_count, 0) AS rating_count,
    COALESCE(s.views, 0) AS views,
    COALESCE(c.chapter_count, 0) AS chapter_count,
    COALESCE(c.last_chapter_at, n.latest_chapter_published_at) AS last_chapter_at
   FROM ((public.novels n
     LEFT JOIN public.novel_stats s ON ((s.novel_id = n.id)))
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS chapter_count,
            max(chapters.published_at) AS last_chapter_at
           FROM public.chapters
          WHERE (chapters.novel_id = n.id)) c ON (true));

ALTER VIEW public.novels_view OWNER TO supabase_admin;
GRANT SELECT ON public.novels_view TO anon, authenticated;
