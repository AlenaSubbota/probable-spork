/* eslint-disable no-console */
// scripts/migrate-legacy-covers-to-storage.mjs
//
// Одноразовая миграция: 22 легаси-обложки лежат в БД как `covers/<имя>.webp`.
// Эти файлы исторически отдавал статикой tene-frontend-app:80; на chaptify
// они идут через цепочку chaptify-web → tene.fun, и tene-frontend-app
// нестабилен — Safari/WKWebView вешает loading-индикатор когда апстрим
// тормозит.
//
// Что делает скрипт:
//   1. SELECT id, title, cover_url FROM novels WHERE cover_url LIKE 'covers/%'
//   2. Для каждой записи качает https://tene.fun/<cover_url>
//   3. Загружает файл в Supabase Storage bucket `covers` под тем же именем
//      (`<имя>.webp`, без префикса `covers/`).
//   4. БД НЕ ТРОГАЕТ — иначе у tene.fun обложки потеряются (БД shared).
//      Парный код-фикс в src/lib/format.ts: ветка для `covers/<...>` теперь
//      возвращает `/sb-storage/v1/object/public/covers/<...>` вместо `/covers/`.
//
// Идемпотентен: если файл уже в bucket, пропускает.
//
// Запуск:
//   SUPABASE_URL=https://tene.fun \
//   SUPABASE_SERVICE_ROLE_KEY=<key> \
//   node scripts/migrate-legacy-covers-to-storage.mjs
//
//   --dry-run   только показать что будет, ничего не загружая
//   --bucket=X  имя бакета (дефолт: covers)

import { createClient } from '@supabase/supabase-js';
import { Buffer } from 'node:buffer';
import process from 'node:process';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TENE_BASE = process.env.TENE_BASE || 'https://tene.fun';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Need env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const BUCKET =
  [...args].find((a) => a.startsWith('--bucket='))?.slice('--bucket='.length) ||
  'covers';

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

console.log(
  `[start] supabase=${new URL(SUPABASE_URL).hostname} bucket=${BUCKET} dry=${DRY}`,
);

const { data: novels, error: selectErr } = await sb
  .from('novels')
  .select('id, title, cover_url')
  .like('cover_url', 'covers/%')
  .order('id');

if (selectErr) {
  console.error('[fail] SELECT novels:', selectErr.message);
  process.exit(1);
}

console.log(`[found] ${novels.length} легаси-новелл с covers/<...> в БД`);

let uploaded = 0;
let skipped = 0;
let failed = 0;
const failures = [];

for (const n of novels) {
  const filename = n.cover_url.slice('covers/'.length);
  const sourceUrl = `${TENE_BASE}/${n.cover_url}`;

  // Идемпотентность: если файл уже в bucket, пропускаем без скачивания.
  const { data: existingList, error: listErr } = await sb.storage
    .from(BUCKET)
    .list('', { search: filename, limit: 5 });
  if (listErr) {
    console.error(`[fail] list bucket "${BUCKET}":`, listErr.message);
    failed++;
    failures.push({ id: n.id, title: n.title, reason: listErr.message });
    continue;
  }
  if (existingList?.some((f) => f.name === filename)) {
    console.log(
      `[skip ] #${n.id} «${n.title}»: ${filename} уже в bucket`,
    );
    skipped++;
    continue;
  }

  if (DRY) {
    console.log(
      `[dry  ] #${n.id} «${n.title}»: GET ${sourceUrl} → upload ${BUCKET}/${filename}`,
    );
    continue;
  }

  // Качаем с tene.fun. URL уже URL-safe (cover_url хранится с кириллицей,
  // но fetch() её сам закодирует в Request URL). На всякий — encode-им
  // только pathname-часть.
  const encodedSource = `${TENE_BASE}/covers/${encodeURIComponent(filename)}`;
  let resp;
  try {
    resp = await fetch(encodedSource, { redirect: 'follow' });
  } catch (e) {
    console.error(`[fail] #${n.id}: fetch ${encodedSource}:`, e.message);
    failed++;
    failures.push({ id: n.id, title: n.title, reason: `fetch: ${e.message}` });
    continue;
  }
  if (!resp.ok) {
    console.error(
      `[fail] #${n.id}: HTTP ${resp.status} on ${encodedSource}`,
    );
    failed++;
    failures.push({
      id: n.id,
      title: n.title,
      reason: `HTTP ${resp.status}`,
    });
    continue;
  }

  const contentType = resp.headers.get('content-type') || 'image/webp';
  const arr = await resp.arrayBuffer();
  const body = Buffer.from(arr);

  // upsert: false чтобы случайно не затереть свежий файл, если он там
  // оказался между list и upload (race с другим запуском).
  const { error: upErr } = await sb.storage
    .from(BUCKET)
    .upload(filename, body, {
      contentType,
      upsert: false,
    });
  if (upErr) {
    console.error(`[fail] #${n.id}: upload "${filename}":`, upErr.message);
    failed++;
    failures.push({ id: n.id, title: n.title, reason: upErr.message });
    continue;
  }

  console.log(
    `[ok   ] #${n.id} «${n.title}»: ${filename} (${(body.length / 1024).toFixed(1)} КБ, ${contentType})`,
  );
  uploaded++;
}

console.log(
  `\n[done] uploaded=${uploaded}  skipped=${skipped}  failed=${failed}`,
);
if (failures.length) {
  console.log('\nFailed:');
  for (const f of failures) {
    console.log(`  #${f.id} «${f.title}» — ${f.reason}`);
  }
  process.exit(2);
}
process.exit(0);
