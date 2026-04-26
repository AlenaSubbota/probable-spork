// scripts/migrate-footnotes.mjs
// -----------------------------------------------------------------------------
// Однократная миграция сносок к каноническому виду chaptify.
//
// Что делает:
//   - Берёт все главы новеллы по NOVEL_ID.
//   - Для каждой главы скачивает HTML из bucket chapter_content.
//   - Ищет ПАРЫ:
//       <p>…[N]…</p>  +  сразу следом  <p>[N] определение</p>
//     (между ними допускается только whitespace).
//   - Заменяет на каноническую разметку:
//       <p>…<sup class="fn-ref" data-fn-id="K">K</sup>…</p>
//       <p class="fn-inline" id="fn-K"><sup>K</sup> определение</p>
//     где K — сквозной счётчик 1..M по главе. Это автоматически чинит
//     ручные ошибки нумерации (например, [1], [1], [2] -> 1, 2, 3).
//   - Кладёт исходник в backup-bucket-префикс, потом загружает результат.
//   - Идемпотентен: если HTML уже содержит class="fn-inline", главу
//     пропускаем.
//
// Как пользоваться:
//   # сухой прогон одной новеллы (ничего не трогает в storage)
//   node scripts/migrate-footnotes.mjs <NOVEL_ID> --dry-run
//
//   # реальный прогон
//   node scripts/migrate-footnotes.mjs <NOVEL_ID>
//
//   # ограничить диапазон глав
//   node scripts/migrate-footnotes.mjs <NOVEL_ID> --from 5 --to 12
//
// Требования по env (в .env проекта):
//   NEXT_PUBLIC_SUPABASE_URL=...
//   SUPABASE_SERVICE_ROLE_KEY=...
// -----------------------------------------------------------------------------

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const BUCKET = 'chapter_content';
const BACKUP_PREFIX = '_fn_migration_backup';

// ---- ядро трансформации ----

// Достаточно консервативно: ищем абзац с маркером, потом сразу следом
// абзац-определение `<p>[N] …</p>`. Допускаем whitespace между ними и
// возможные классы/атрибуты на исходном <p>.
const PAIR_RE = /<p\b([^>]*)>([\s\S]*?\[(\d+)\][\s\S]*?)<\/p>(\s*)<p\b[^>]*>\s*\[\3\]\s+([\s\S]*?)<\/p>/i;

/**
 * Преобразует HTML главы. Возвращает { html, count } или null если
 * менять нечего (или глава уже в новом формате).
 */
export function migrateChapter(html) {
  if (typeof html !== 'string' || !html.trim()) return null;
  // идемпотентность
  if (html.includes('class="fn-inline"')) return null;
  if (html.includes('class="fn-ref"')) return null;

  let working = html;
  let counter = 0;
  let changed = false;
  // Жадно проходим парами «исходник + определение». Каждая итерация
  // увеличивает счётчик и подставляет K, игнорируя исходное N.
  // Защита от зацикливания: если регэксп вдруг возвращает совпадение
  // нулевой длины — выходим (на практике невозможно, но пусть будет).
  for (let safety = 0; safety < 5000; safety += 1) {
    const m = working.match(PAIR_RE);
    if (!m) break;
    counter += 1;
    const K = counter;
    const [whole, srcAttrs, srcBody, num, _wsBetween, defBody] = m;
    // В исходном абзаце меняем ПЕРВЫЙ найденный [num] (с опциональным пробелом перед ним) на <sup>
    const srcReplaced = srcBody.replace(
      new RegExp(`\\s?\\[${num}\\]`),
      `<sup class="fn-ref" data-fn-id="${K}">${K}</sup>`,
    );
    const replacement =
      `<p${srcAttrs}>${srcReplaced}</p>\n` +
      `<p class="fn-inline" id="fn-${K}"><sup>${K}</sup> ${defBody.trim()}</p>`;
    const idx = working.indexOf(whole);
    if (idx < 0 || whole.length === 0) break;
    working = working.slice(0, idx) + replacement + working.slice(idx + whole.length);
    changed = true;
  }

  if (!changed) return null;
  return { html: working, count: counter };
}

// ---- main ----

function getEnv(name, fallbacks = []) {
  for (const k of [name, ...fallbacks]) {
    if (process.env[k]) return process.env[k];
  }
  return null;
}

async function main({ NOVEL_ID, DRY_RUN, FROM, TO }) {
  const SUPABASE_URL = getEnv('NEXT_PUBLIC_SUPABASE_URL', ['VITE_SUPABASE_URL', 'SUPABASE_URL']);
  const SUPABASE_SERVICE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ Не найдены NEXT_PUBLIC_SUPABASE_URL и/или SUPABASE_SERVICE_ROLE_KEY в окружении.');
    console.error('   Запускай через `set -a; source .env; set +a; node scripts/migrate-footnotes.mjs ...`');
    process.exit(1);
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  console.log(`🚀 Старт миграции сносок для новеллы ID=${NOVEL_ID} ${DRY_RUN ? '(dry-run)' : ''}`);

  const { data: novel, error: novelError } = await supabase
    .from('novels')
    .select('id, firebase_id, title')
    .eq('id', NOVEL_ID)
    .single();

  if (novelError || !novel) {
    console.error(`❌ Не нашёл новеллу ID=${NOVEL_ID}: ${novelError?.message ?? 'unknown'}`);
    process.exit(1);
  }
  console.log(`📚 Новелла: "${novel.title}" (firebase_id=${novel.firebase_id})`);

  let chQuery = supabase
    .from('chapters')
    .select('id, chapter_number, content_path')
    .eq('novel_id', novel.id)
    .order('chapter_number', { ascending: true });
  if (FROM != null) chQuery = chQuery.gte('chapter_number', FROM);
  if (TO != null) chQuery = chQuery.lte('chapter_number', TO);

  const { data: chapters, error: chErr } = await chQuery;
  if (chErr || !chapters) {
    console.error(`❌ Ошибка списка глав: ${chErr?.message ?? 'unknown'}`);
    process.exit(1);
  }
  console.log(`📄 К обработке: ${chapters.length} глав\n`);

  const logLines = [];
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const ch of chapters) {
    const tag = `Глава ${String(ch.chapter_number).padStart(3, ' ')}`;
    if (!ch.content_path) {
      console.log(`${tag} ⏭ нет content_path`);
      skipped += 1;
      continue;
    }
    const cleanPath = ch.content_path.split('?')[0];
    try {
      const { data: file, error: dlErr } = await supabase.storage.from(BUCKET).download(cleanPath);
      if (dlErr || !file) {
        console.log(`${tag} ❌ download: ${dlErr?.message ?? 'unknown'}`);
        errors += 1;
        continue;
      }
      const original = await file.text();
      const result = migrateChapter(original);

      if (!result) {
        console.log(`${tag} 💤 без изменений`);
        skipped += 1;
        continue;
      }

      logLines.push(`Ch ${ch.chapter_number}: ${result.count} fn -> К каноническому виду (1..${result.count})`);

      if (DRY_RUN) {
        console.log(`${tag} 🔍 dry: ${result.count} сносок`);
        // Покажем кусочек первого изменения для глазного контроля (только для первых 3 глав).
        if (updated < 3) {
          const sample = result.html.slice(0, 600).replace(/\s+/g, ' ');
          console.log(`        → ${sample}…`);
        }
        updated += 1;
        continue;
      }

      // Бэкап до загрузки. Кладём в тот же bucket с префиксом, чтобы можно было
      // откатиться вручную: storage.from(BUCKET).download(`${BACKUP_PREFIX}/...`)
      const backupPath = `${BACKUP_PREFIX}/${cleanPath}`;
      const { error: backupErr } = await supabase.storage
        .from(BUCKET)
        .upload(backupPath, Buffer.from(original, 'utf-8'), {
          contentType: 'text/html; charset=utf-8',
          upsert: true,
        });
      if (backupErr) {
        console.log(`${tag} ⚠ бэкап не записался: ${backupErr.message}. Пропускаю главу.`);
        errors += 1;
        continue;
      }

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(cleanPath, Buffer.from(result.html, 'utf-8'), {
          contentType: 'text/html; charset=utf-8',
          cacheControl: '3600',
          upsert: true,
        });
      if (upErr) {
        console.log(`${tag} ❌ upload: ${upErr.message}`);
        errors += 1;
        continue;
      }
      console.log(`${tag} ✅ обновлено (${result.count} сносок)`);
      updated += 1;
    } catch (err) {
      console.log(`${tag} 🔥 сбой: ${err?.message ?? String(err)}`);
      errors += 1;
    }
  }

  console.log('\n-----------------------------------');
  console.log(`🏁 Готово ${DRY_RUN ? '(dry-run)' : ''}`);
  console.log(`✅ Обновлено: ${updated}`);
  console.log(`💤 Без изменений: ${skipped}`);
  console.log(`❌ Ошибок: ${errors}`);

  // Лог в файл
  if (logLines.length > 0) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const logDir = path.join(process.cwd(), 'scripts', 'logs');
    await mkdir(logDir, { recursive: true });
    const logPath = path.join(logDir, `migrate-footnotes-novel${NOVEL_ID}-${ts}${DRY_RUN ? '-dry' : ''}.log`);
    await writeFile(logPath, logLines.join('\n') + '\n', 'utf-8');
    console.log(`📝 Лог: ${logPath}`);
  }
}

// Запуск из CLI: node scripts/migrate-footnotes.mjs <id> [--dry-run] [--from N --to M]
const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  const args = process.argv.slice(2);
  const NOVEL_ID = args.find((a) => /^\d+$/.test(a));
  if (!NOVEL_ID) {
    console.error('❌ Укажи ID новеллы: node scripts/migrate-footnotes.mjs 8 [--dry-run] [--from N --to M]');
    process.exit(1);
  }
  const DRY_RUN = args.includes('--dry-run');
  const fromIdx = args.indexOf('--from');
  const toIdx = args.indexOf('--to');
  const FROM = fromIdx >= 0 ? Number(args[fromIdx + 1]) : null;
  const TO = toIdx >= 0 ? Number(args[toIdx + 1]) : null;

  main({ NOVEL_ID, DRY_RUN, FROM, TO }).catch((err) => {
    console.error('Критическая ошибка:', err);
    process.exit(1);
  });
}
