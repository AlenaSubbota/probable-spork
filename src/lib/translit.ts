// Транслитерация русского в латиницу. Используется только для перевода
// легаси-имён обложек (`covers/тролльь.webp` → `trollh.webp`) в имя
// объекта в Supabase Storage: bucket-API не принимает кириллицу в ключах
// (`Invalid key: скан.webp`), поэтому при заливке файлов и при формировании
// URL на фронте обе стороны должны прийти к одному и тому же ASCII-имени.
//
// ВАЖНО: эта таблица должна быть синхронизирована с
// scripts/migrate-legacy-covers-to-storage.mjs. Если меняешь одно —
// меняй оба, иначе фронт будет адресовать файл, которого в bucket нет.
//
// Не претендует на лингвистическую точность (ISO 9 / ГОСТ — иное); цель
// одна: детерминированно отобразить кириллицу в безопасные ASCII-байты.
const RU_TO_LAT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function transliterateRu(s: string): string {
  return s
    .split('')
    .map((ch) => {
      const lower = ch.toLowerCase();
      if (lower in RU_TO_LAT) return RU_TO_LAT[lower];
      return ch;
    })
    .join('');
}
