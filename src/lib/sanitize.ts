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
    // На SSR DOMParser недоступен — fallback на серверный санитайзер.
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
// Серверный санитайзер UGC HTML.
//
// История:
//   - v1: isomorphic-dompurify → в Next 16 standalone build вшивал
//     dompurify в server-bundle с unbounded ссылкой на DOM-глобал
//     `Element`. Прод падал `ReferenceError: Element is not defined`.
//     serverExternalPackages не помог. Коммиты d058d3d / 8b0d3da.
//   - v2: regex-стриппер (43b6719). Работал, но слабый против
//     обфусцированных XSS (HTML-сущности, unicode, вложенные
//     <scr<script>ipt>, mixed-case атрибуты).
//   - v3 (эта): sanitize-html — pure JS, использует htmlparser2,
//     без DOM-глобалов. Покрывает обфускацию через настоящий парсер,
//     гарантированно работает в Node-bundle.
//
// Whitelist подобран под существующий редактор (тот же KEEP_TAGS) +
// сноски/details. Защита javascript:-схем — через allowedSchemes.
// CSP в next.config.ts закрывает defense-in-depth.
// -----------------------------------------------------------

import sanitizeHtml from 'sanitize-html';

const ALLOWED_CLASS_TOKENS_FOR_TAG: Record<string, Set<string>> = {
  p:   new Set(['fn-inline']),
  sup: new Set(['fn-ref']),
};

function filterClassId(
  attribs: Record<string, string>,
  tag: 'p' | 'sup',
): Record<string, string> {
  const out: Record<string, string> = { ...attribs };

  if (out.class) {
    const allowed = ALLOWED_CLASS_TOKENS_FOR_TAG[tag];
    const tokens = out.class.split(/\s+/).filter((t) => allowed.has(t));
    if (tokens.length > 0) out.class = tokens.join(' ');
    else delete out.class;
  }

  if (out.id) {
    // id для якоря сноски: только формат fn-N
    if (!(tag === 'p' && /^fn-\d+$/.test(out.id))) delete out.id;
  }

  return out;
}

const UGC_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'strong', 'em', 'u', 's', 'h3',
    'blockquote', 'details', 'summary', 'sup',
    // ссылки в описаниях/новостях
    'a',
    // картинки в новостях/описаниях
    'img', 'figure', 'figcaption',
  ],
  allowedAttributes: {
    p:    ['style', 'class', 'id'],
    h3:   ['style'],
    sup:  ['class', 'data-fn-id', 'data-fn-text'],
    a:    ['href', 'target', 'rel'],
    img:  ['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding'],
  },
  // Только http/https/mailto. Запрещены javascript:, vbscript:, data:,
  // file:, about:, blob:. Без явного списка sanitize-html по дефолту
  // допускает много схем (включая ftp), мы ужимаем.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href', 'src', 'cite'],
  // Запрещаем protocol-relative `//evil.com` (по дефолту разрешено).
  allowProtocolRelative: false,
  // Style: только text-align:center на <p>/<h3>.
  allowedStyles: {
    p:  { 'text-align': [/^center$/] },
    h3: { 'text-align': [/^center$/] },
  },
  selfClosing: ['img', 'br'],
  // Парсим style-атрибут чтобы фильтровать через allowedStyles.
  parseStyleAttributes: true,
  // Опасные теги вырезаем ВМЕСТЕ с содержимым (по дефолту sanitize-html
  // сохраняет text внутри <script>!).
  disallowedTagsMode: 'discard',
  transformTags: {
    a: (tagName, attribs) => {
      const out: Record<string, string> = { ...attribs };
      if (out.target === '_blank') {
        // Принудительный rel=noopener против reverse tab-nabbing.
        out.rel = 'noopener noreferrer';
      } else {
        delete out.target;
      }
      return { tagName, attribs: out };
    },
    p: (tagName, attribs) => ({ tagName, attribs: filterClassId(attribs, 'p') }),
    sup: (tagName, attribs) => ({ tagName, attribs: filterClassId(attribs, 'sup') }),
    img: (tagName, attribs) => {
      const out: Record<string, string> = { ...attribs };
      if (!out.loading) out.loading = 'lazy';
      if (!out.decoding) out.decoding = 'async';
      return { tagName, attribs: out };
    },
  },
};

export function sanitizeUgcHtml(input: string | null | undefined): string {
  if (!input) return '';
  return sanitizeHtml(String(input), UGC_OPTIONS);
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
