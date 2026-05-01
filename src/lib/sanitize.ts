// -----------------------------------------------------------
// Санитизация HTML для админ-редактора глав.
//
// Принимает любой грязный HTML — из Word, Google Docs, .docx или
// сам редактор contentEditable — и приводит к узкому white-list:
//   <p>, <br>, <strong>, <em>, <u>, <s>,
//   <h3>, <blockquote>, <details>, <summary>,
//   <sup class="fn-ref" data-fn-id="N">  (сноски в тексте)
//   <p class="fn-inline" id="fn-N">      (определения сносок)
//
// Из стилей оставляем только text-align:center на <p> и <h3>.
// -----------------------------------------------------------

const KEEP_TAGS = new Set([
  'P','BR','STRONG','EM','U','S','H3','BLOCKQUOTE','DETAILS','SUMMARY','SUP',
]);

const RENAME_TAG: Record<string, string> = {
  B: 'STRONG', I: 'EM', STRIKE: 'S', DIV: 'P',
  H1: 'H3', H2: 'H3', H4: 'H3', H5: 'H3', H6: 'H3',
};

const INLINE_TAGS = new Set(['B','STRONG','I','EM','U','S','STRIKE','SPAN','FONT']);
const BLOCK_TAGS = new Set(['P','DIV','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','UL','OL','TABLE','PRE']);

function hasBlockChildren(el: Element): boolean {
  for (const child of Array.from(el.children)) {
    if (BLOCK_TAGS.has(child.tagName)) return true;
  }
  return false;
}

const ALLOWED_ATTRS: Record<string, string[]> = {
  P: ['style', 'class', 'id'],
  H3: ['style'],
  BLOCKQUOTE: [], DETAILS: [], SUMMARY: [],
  STRONG: [], EM: [], U: [], S: [], BR: [],
  SUP: ['class', 'data-fn-id', 'data-fn-text'],
};

export function cleanHtml(input: string): string {
  if (!input) return '';
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    // На SSR DOMParser недоступен — fallback на серверный регекс-санитайзер.
    return sanitizeUgcHtml(input);
  }

  const pre = input
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(?:o|w|m|st1|xml|v):[a-z][^>]*>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<meta\b[^>]*>/gi, '')
    .replace(/<link\b[^>]*>/gi, '');

  const doc = new DOMParser().parseFromString(`<body>${pre}</body>`, 'text/html');
  cleanNode(doc.body, doc);

  let out = doc.body.innerHTML;
  out = out
    .replace(/<p[^>]*>\s*(?:&nbsp;| |\s)*<\/p>/gi, '')
    .replace(/(?:<br\s*\/?>\s*){3,}/gi, '<br><br>')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return out;
}

function cleanNode(node: Node, doc: Document): void {
  const children = Array.from(node.childNodes);
  for (const child of children) {
    if (child.nodeType === Node.COMMENT_NODE) { child.remove(); continue; }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    let el = child as HTMLElement;

    if (INLINE_TAGS.has(el.tagName) && hasBlockChildren(el)) {
      cleanNode(el, doc); unwrap(el); continue;
    }

    if (el.tagName === 'SPAN') {
      const style = (el.getAttribute('style') ?? '').toLowerCase();
      const wasItalic = /font-style\s*:\s*italic/.test(style);
      const wasBold = /font-weight\s*:\s*(?:bold|[6-9]00)/.test(style);
      if (wasItalic || wasBold) {
        const wrap = doc.createElement(wasBold ? 'strong' : 'em');
        let inner: HTMLElement = wrap;
        if (wasBold && wasItalic) {
          const em = doc.createElement('em');
          wrap.appendChild(em);
          inner = em;
        }
        while (el.firstChild) inner.appendChild(el.firstChild);
        el.replaceWith(wrap);
        cleanNode(wrap, doc);
        continue;
      }
      unwrap(el); continue;
    }

    if (el.tagName === 'FONT') { unwrap(el); continue; }

    if (el.tagName === 'CENTER') {
      const p = doc.createElement('p');
      p.setAttribute('style', 'text-align:center');
      while (el.firstChild) p.appendChild(el.firstChild);
      el.replaceWith(p);
      el = p;
    }

    if (el.tagName === 'P' && el.getAttribute('align') === 'center') {
      el.removeAttribute('align');
      const prev = el.getAttribute('style') ?? '';
      if (!/text-align/i.test(prev)) {
        el.setAttribute('style', prev ? `${prev};text-align:center` : 'text-align:center');
      }
    }

    if (el.tagName === 'P') {
      const cls = el.getAttribute('class') ?? '';
      if (/\bcenter\b/i.test(cls) && !/\bfn-inline\b/.test(cls)) {
        const prev = el.getAttribute('style') ?? '';
        if (!/text-align\s*:\s*center/i.test(prev)) {
          el.setAttribute('style', prev ? `${prev};text-align:center` : 'text-align:center');
        }
      }
    }

    const renameTo = RENAME_TAG[el.tagName];
    if (renameTo) {
      const fresh = doc.createElement(renameTo.toLowerCase());
      for (const attr of Array.from(el.attributes)) {
        fresh.setAttribute(attr.name, attr.value);
      }
      while (el.firstChild) fresh.appendChild(el.firstChild);
      el.replaceWith(fresh);
      el = fresh;
    }

    if (!KEEP_TAGS.has(el.tagName)) {
      cleanNode(el, doc); unwrap(el); continue;
    }

    sanitizeAttrs(el);
    cleanNode(el, doc);
  }
}

function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) { el.remove(); return; }
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

function sanitizeAttrs(el: HTMLElement): void {
  const allowed = ALLOWED_ATTRS[el.tagName] ?? [];
  for (const attr of Array.from(el.attributes)) {
    if (!allowed.includes(attr.name)) el.removeAttribute(attr.name);
  }

  if (el.hasAttribute('style')) {
    const style = (el.getAttribute('style') ?? '').toLowerCase();
    if (/text-align\s*:\s*center/.test(style) &&
        (el.tagName === 'P' || el.tagName === 'H3')) {
      el.setAttribute('style', 'text-align:center');
    } else {
      el.removeAttribute('style');
    }
  }

  if (el.hasAttribute('class')) {
    const cls = el.getAttribute('class') ?? '';
    if (el.tagName === 'P' && /\bfn-inline\b/.test(cls)) {
      el.setAttribute('class', 'fn-inline');
    } else if (el.tagName === 'SUP' && /\bfn-ref\b/.test(cls)) {
      el.setAttribute('class', 'fn-ref');
    } else {
      el.removeAttribute('class');
    }
  }

  if (el.hasAttribute('id')) {
    const id = el.getAttribute('id') ?? '';
    if (el.tagName === 'P' && /^fn-\d+$/.test(id)) {
      // оставляем
    } else {
      el.removeAttribute('id');
    }
  }
}

export function materializeFootnotes(html: string): string {
  if (!html || typeof window === 'undefined') return html;
  if (!html.includes('data-fn-text') && !html.includes('fn-ref')) return html;

  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const sups = Array.from(
    doc.body.querySelectorAll('sup.fn-ref, sup[data-fn-text]'),
  ) as HTMLElement[];
  if (sups.length === 0) return html;

  doc.body.querySelectorAll('p.fn-inline').forEach((p) => p.remove());

  const fnByParagraph = new Map<Element, Array<{ n: number; text: string }>>();
  let counter = 0;
  for (const sup of sups) {
    counter += 1;
    const n = counter;
    const text = sup.getAttribute('data-fn-text') ?? sup.textContent?.trim() ?? '';
    sup.setAttribute('class', 'fn-ref');
    sup.setAttribute('data-fn-id', String(n));
    sup.removeAttribute('data-fn-text');
    sup.textContent = String(n);

    let p: Element | null = sup;
    while (p && p.parentElement && p.parentElement !== doc.body) {
      p = p.parentElement;
    }
    if (!p) continue;
    if (!fnByParagraph.has(p)) fnByParagraph.set(p, []);
    fnByParagraph.get(p)!.push({ n, text });
  }

  for (const [p, fns] of fnByParagraph) {
    let after: Element = p;
    for (const fn of fns) {
      const fp = doc.createElement('p');
      fp.setAttribute('class', 'fn-inline');
      fp.setAttribute('id', `fn-${fn.n}`);
      fp.innerHTML = `<sup>${fn.n}</sup> ${escapeHtml(fn.text)}`;
      after.after(fp);
      after = fp;
    }
  }

  return doc.body.innerHTML;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// -----------------------------------------------------------
// АВАРИЙНЫЙ серверный санитайзер UGC HTML.
//
// История:
//   - Изначально на сервере использовался isomorphic-dompurify (DOMPurify+jsdom).
//   - В Next 16 + output:'standalone' DOMPurify попадал в server bundle
//     с unbounded ссылкой на DOM-глобал `Element`. На сервере глобала нет
//     → `ReferenceError: Element is not defined` на КАЖДОМ SSR-рендере
//     страниц с UGC (новелла, глава, новость, модерация). Прод лежал.
//   - serverExternalPackages в next.config.ts не помог: standalone-build
//     всё равно вшивал DOMPurify в bundle.
//
// Эта ревизия — выкинули DOMPurify полностью, заменили на regex-стриппер.
// Слабее, чем DOMPurify, но:
//   - Не зависит от DOM-глобалов, гарантированно работает в Node-bundle.
//   - Покрывает основные XSS-векторы: <script>, <iframe>, <object>,
//     <embed>, <link>, <meta>, <form>, <svg>, <noscript>, <style>,
//     <template>, on*-handlers, javascript:/vbscript:/data:/file:/about:/
//     blob:-URL-схемы, HTML-комментарии (включая conditional comments).
//   - Translator UGC у нас обычно cleanHtml() прогнан клиентом до сабмита,
//     то есть «грязный» HTML на сервере встречается редко.
//
// План на «нормальный» фикс:
//   - Перейти на `sanitize-html` (pure JS, без jsdom, без DOM-глобалов),
//     ИЛИ настроить DOMPurify через ручной jsdom-instance (без
//     isomorphic-dompurify).
//   - Покрыть тестами bypass-векторы.
// -----------------------------------------------------------

const STRIP_TAGS_RE =
  /<(script|style|iframe|object|embed|noscript|form|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi;

const VOID_DANGEROUS_RE = /<(meta|link|base|input|button|frame|frameset)\b[^>]*\/?>/gi;

// on*-обработчики в атрибутах: onclick, onerror, ontoggle, onload и т.п.
const ON_ATTR_RE = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

// Опасные URL-схемы внутри атрибутов href/src/action и т.д.
const DANGEROUS_URL_RE = /\b(?:javascript|vbscript|data|file|about|blob)\s*:/gi;

// Голые открывающие теги опасных элементов без закрытия.
const ORPHAN_OPEN_TAG_RE =
  /<(script|iframe|object|embed|svg|form|noscript|style|template)\b[^>]*>/gi;

export function sanitizeUgcHtml(input: string | null | undefined): string {
  if (!input) return '';
  let s = String(input);

  // 1. Уносим целиком опасные блоки с содержимым (несколько проходов
  //    на случай вложенности).
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(STRIP_TAGS_RE, '');
    if (s === before) break;
  }

  // 2. Void-теги типа <meta>, <link>.
  s = s.replace(VOID_DANGEROUS_RE, '');

  // 3. on*-обработчики со всех тегов.
  s = s.replace(ON_ATTR_RE, '');

  // 4. Опасные URL-схемы → пустая строка. Ловим в любом контексте.
  s = s.replace(DANGEROUS_URL_RE, '');

  // 5. Голые открывающие теги без закрытия (битый HTML).
  s = s.replace(ORPHAN_OPEN_TAG_RE, '');

  // 6. HTML-комментарии (могут содержать conditional <!--[if IE]>...).
  s = s.replace(/<!--[\s\S]*?-->/g, '');

  return s;
}

// Только http/https/anchor и path-relative БЕЗ '//' префикса.
// `\/(?!\/)` явно запрещает protocol-relative `//evil.com`.
// Отбрасывает javascript:/data:/vbscript:/file:/about: — всё, что может
// что-то выполнить.
const SAFE_URL_RE = /^(?:https?:\/\/|\/(?!\/)|#|\.\.?\/)/i;

export function safeUrl(url: string | null | undefined): string {
  if (!url) return '';
  const s = String(url).trim();
  if (SAFE_URL_RE.test(s)) return s;
  return '';
}
