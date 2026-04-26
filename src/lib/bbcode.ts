// -----------------------------------------------------------
// Простой BB-код → HTML конвертер. Используется в формах,
// чтобы переводчики не писали HTML-теги руками (путаются).
// Поддерживает: [b] [i] [u] [s] [quote] [spoiler] [center] [h] [fn]
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

// Разбиваем входной текст на «чанки-абзацы» (по двойному переносу).
// Возвращает массив строк, в которых блочные теги уже сохранены как есть,
// а обычный текст готов к оборачиванию в <p>.
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

// Внутри одного абзаца:
// - вытаскиваем все [fn]…[/fn] по очереди, заменяем на <sup class="fn-ref">N</sup>
// - параллельно копим список пояснений
// counter — внешний счётчик сквозной нумерации по всей главе.
// Возвращает { html, footnotes } — html абзаца и список вынесенных сносок.
function extractFootnotesFromChunk(
  chunk: string,
  counter: { n: number },
): { html: string; footnotes: Array<{ n: number; text: string }> } {
  const footnotes: Array<{ n: number; text: string }> = [];
  // [fn]…[/fn] на экранированном тексте — никаких ` < > ` внутри быть не должно.
  // Заметка: split-функция вызывается ДО общего escape, чтобы маркер можно
  // было поставить даже внутри предложения с тире/кавычками — escape применим
  // отдельно к якорю и к телу сноски ниже.
  const html = chunk.replace(
    /\[fn\]([\s\S]*?)\[\/fn\]/gi,
    (_m, body: string) => {
      counter.n += 1;
      const n = counter.n;
      footnotes.push({ n, text: body.trim() });
      return `<sup class="fn-ref" data-fn-id="${n}">${n}</sup>`;
    },
  );
  return { html, footnotes };
}

// Оборачиваем «голый» чанк в <p>…</p>, если он не начинается с блочного тега.
// Одиночные \n внутри → <br>.
function wrapChunkAsParagraph(chunk: string): string {
  if (/^<(h[1-6]|p|blockquote|details|ul|ol|div|table)\b/i.test(chunk)) {
    return chunk;
  }
  const withBr = chunk.replace(/\n/g, '<br>');
  return `<p>${withBr}</p>`;
}

export function bbToHtml(input: string): string {
  if (!input) return '';

  // 1. Экранируем исходный HTML, чтобы нельзя было вписать теги руками
  let escaped = escapeHtml(input);

  // 2. Применяем простые BB-коды (они работают на экранированном тексте)
  for (const { re, repl } of TAGS) {
    escaped = escaped.replace(re, repl);
  }

  // 3. Двухпроходка для сносок: разбиваем на абзацы, в каждом извлекаем
  // [fn]…[/fn] со сквозной нумерацией, после абзаца выпускаем <p class="fn-inline">.
  const counter = { n: 0 };
  const out: string[] = [];
  for (const chunk of splitParagraphs(escaped)) {
    const { html: chunkWithSups, footnotes } = extractFootnotesFromChunk(chunk, counter);
    out.push(wrapChunkAsParagraph(chunkWithSups));
    for (const fn of footnotes) {
      out.push(
        `<p class="fn-inline" id="fn-${fn.n}"><sup>${fn.n}</sup> ${fn.text}</p>`,
      );
    }
  }

  return out.join('\n');
}

// Обратное преобразование: HTML → BB-коды (для редактирования существующих новелл/глав).
// Особый случай — сноски: ищем все <p class="fn-inline" id="fn-N">…</p>, забираем их
// текст в карту по N и вырезаем из потока, а в основном тексте каждый
// <sup class="fn-ref" data-fn-id="N">N</sup> заменяем на [fn]<текст>[/fn].
function inlineFootnotesBack(html: string): string {
  const defs = new Map<string, string>();
  // Собираем определения: <p class="fn-inline" id="fn-N"><sup>N</sup> текст</p>
  let cleaned = html.replace(
    /<p\b[^>]*\bclass="[^"]*\bfn-inline\b[^"]*"[^>]*\bid="fn-(\d+)"[^>]*>([\s\S]*?)<\/p>/gi,
    (_m, n: string, body: string) => {
      // Внутри тела убираем ведущий <sup>N</sup> с пробелом
      const text = body.replace(/^\s*<sup[^>]*>\s*\d+\s*<\/sup>\s*/i, '').trim();
      defs.set(n, text);
      return '';
    },
  );
  // Нормализуем последствия — лишние пустые строки между абзацами
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // Заменяем <sup class="fn-ref" data-fn-id="N">N</sup> на [fn]текст[/fn]
  cleaned = cleaned.replace(
    /<sup\b[^>]*\bclass="[^"]*\bfn-ref\b[^"]*"[^>]*\bdata-fn-id="(\d+)"[^>]*>[\s\S]*?<\/sup>/gi,
    (m, n: string) => {
      const text = defs.get(n);
      if (text == null) return m; // не нашли пару — оставим маркер как есть
      return `[fn]${text}[/fn]`;
    },
  );
  return cleaned;
}

export function htmlToBb(html: string): string {
  if (!html) return '';
  // Сначала разворачиваем сноски — они структурные, должны идти до общего стрипа <p>.
  const stage1 = inlineFootnotesBack(html);
  return stage1
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
