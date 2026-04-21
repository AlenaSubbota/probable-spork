// -----------------------------------------------------------
// Простой BB-код → HTML конвертер. Используется в формах,
// чтобы переводчики не писали HTML-теги руками (путаются).
// Поддерживает: [b] [i] [u] [s] [quote] [spoiler] [center] [h]
// Плюс двойной перенос строки → <p>...</p>.
// -----------------------------------------------------------

const TAGS: Array<{ re: RegExp; repl: string }> = [
  // Заголовок [h]...[/h]
  { re: /\[h\]([\s\S]*?)\[\/h\]/gi, repl: '<h3>$1</h3>' },
  // Жирный, курсив, подчёркнутый, зачёркнутый
  { re: /\[b\]([\s\S]*?)\[\/b\]/gi, repl: '<strong>$1</strong>' },
  { re: /\[i\]([\s\S]*?)\[\/i\]/gi, repl: '<em>$1</em>' },
  { re: /\[u\]([\s\S]*?)\[\/u\]/gi, repl: '<u>$1</u>' },
  { re: /\[s\]([\s\S]*?)\[\/s\]/gi, repl: '<s>$1</s>' },
  // Цитата
  { re: /\[quote\]([\s\S]*?)\[\/quote\]/gi, repl: '<blockquote>$1</blockquote>' },
  // Спойлер (в описании) — работает как <details>
  {
    re: /\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi,
    repl: '<details><summary>Спойлер — нажми, чтобы показать</summary>$1</details>',
  },
  // По центру
  { re: /\[center\]([\s\S]*?)\[\/center\]/gi, repl: '<p style="text-align:center">$1</p>' },
];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function textToParagraphs(text: string): string {
  // Пустая строка = разрыв абзаца
  return text
    .split(/\n{2,}/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      // Если в чанке уже есть блочный тег — не оборачиваем
      if (/^<(h[1-6]|p|blockquote|details|ul|ol|div|table)\b/i.test(chunk)) {
        return chunk;
      }
      // Одиночный перенос строки → <br>
      const withBr = chunk.replace(/\n/g, '<br>');
      return `<p>${withBr}</p>`;
    })
    .join('\n');
}

export function bbToHtml(input: string): string {
  if (!input) return '';

  // 1. Экранируем исходный HTML, чтобы нельзя было вписать теги руками
  let out = escapeHtml(input);

  // 2. Применяем BB-коды — они уже работают с экранированным текстом
  for (const { re, repl } of TAGS) {
    out = out.replace(re, repl);
  }

  // 3. Переносы строк → <p>
  out = textToParagraphs(out);

  return out;
}

// Обратное преобразование: HTML → BB-коды (для редактирования существующих новелл/глав)
export function htmlToBb(html: string): string {
  if (!html) return '';
  return html
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, '[b]$1[/b]')
    .replace(/<b>([\s\S]*?)<\/b>/gi, '[b]$1[/b]')
    .replace(/<em>([\s\S]*?)<\/em>/gi, '[i]$1[/i]')
    .replace(/<i>([\s\S]*?)<\/i>/gi, '[i]$1[/i]')
    .replace(/<u>([\s\S]*?)<\/u>/gi, '[u]$1[/u]')
    .replace(/<s>([\s\S]*?)<\/s>/gi, '[s]$1[/s]')
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, '[quote]$1[/quote]')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '[h]$1[/h]')
    .replace(/<details[^>]*>[\s\S]*?<\/summary>([\s\S]*?)<\/details>/gi, '[spoiler]$1[/spoiler]')
    .replace(/<p[^>]*style=[^>]*text-align:\s*center[^>]*>([\s\S]*?)<\/p>/gi, '[center]$1[/center]')
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}
