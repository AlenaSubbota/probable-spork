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
// Inline-стили font-style:italic / font-weight:bold разворачиваются
// в <em> / <strong>. Word boilerplate (<o:p>, <w:*>, conditional
// comments, MsoNormal-классы) выкидывается.
// -----------------------------------------------------------

const KEEP_TAGS = new Set([
  'P',
  'BR',
  'STRONG',
  'EM',
  'U',
  'S',
  'H3',
  'BLOCKQUOTE',
  'DETAILS',
  'SUMMARY',
  'SUP',
]);

// Карта переименований: что слева — превращаем в то что справа,
// сохраняя содержимое.
const RENAME_TAG: Record<string, string> = {
  B: 'STRONG',
  I: 'EM',
  STRIKE: 'S',
  DIV: 'P',
  H1: 'H3',
  H2: 'H3',
  H4: 'H3',
  H5: 'H3',
  H6: 'H3',
};

// Какие атрибуты разрешены на каком теге. Всё остальное — снимаем.
const ALLOWED_ATTRS: Record<string, string[]> = {
  P: ['style', 'class', 'id'],
  H3: ['style'],
  BLOCKQUOTE: [],
  DETAILS: [],
  SUMMARY: [],
  STRONG: [],
  EM: [],
  U: [],
  S: [],
  BR: [],
  SUP: ['class', 'data-fn-id', 'data-fn-text'],
};

export function cleanHtml(input: string): string {
  if (!input) return '';
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    // На SSR оставляем как есть — компонент-консьюмер должен быть client-only.
    return input;
  }

  // Пре-стрип Word/Office-мусора, который ломает DOMParser или
  // тащит лишние сотни КБ.
  let pre = input
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(?:o|w|m|st1|xml|v):[a-z][^>]*>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<meta\b[^>]*>/gi, '')
    .replace(/<link\b[^>]*>/gi, '');

  const doc = new DOMParser().parseFromString(`<body>${pre}</body>`, 'text/html');
  cleanNode(doc.body, doc);

  // Финальная нормализация: убрать пустые абзацы и лишние <br>.
  let out = doc.body.innerHTML;
  out = out
    .replace(/<p[^>]*>\s*(?:&nbsp;| |\s)*<\/p>/gi, '')
    .replace(/(?:<br\s*\/?>\s*){3,}/gi, '<br><br>')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return out;
}

function cleanNode(node: Node, doc: Document): void {
  // Делаем копию списка детей — мы их меняем во время прохода.
  const children = Array.from(node.childNodes);
  for (const child of children) {
    if (child.nodeType === Node.COMMENT_NODE) {
      child.remove();
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    let el = child as HTMLElement;

    // <span style="font-style:italic"> → <em>
    // <span style="font-weight:bold"> → <strong>
    // Прочие <span> — раздеваем (содержимое сохраняем).
    if (el.tagName === 'SPAN') {
      const style = (el.getAttribute('style') ?? '').toLowerCase();
      const wasItalic = /font-style\s*:\s*italic/.test(style);
      const wasBold = /font-weight\s*:\s*(?:bold|[6-9]00)/.test(style);
      if (wasItalic || wasBold) {
        const wrap = doc.createElement(wasBold ? 'strong' : 'em');
        // Если оба сразу — делаем strong > em.
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
      unwrap(el);
      continue;
    }

    // <font color=...>, <font face=...> — снимаем
    if (el.tagName === 'FONT') {
      unwrap(el);
      continue;
    }

    // <center>x</center> → <p style="text-align:center">x</p>
    if (el.tagName === 'CENTER') {
      const p = doc.createElement('p');
      p.setAttribute('style', 'text-align:center');
      while (el.firstChild) p.appendChild(el.firstChild);
      el.replaceWith(p);
      el = p;
    }

    // <p align="center"> → style="text-align:center"
    if (el.tagName === 'P' && el.getAttribute('align') === 'center') {
      el.removeAttribute('align');
      const prev = el.getAttribute('style') ?? '';
      if (!/text-align/i.test(prev)) {
        el.setAttribute(
          'style',
          prev ? `${prev};text-align:center` : 'text-align:center',
        );
      }
    }

    // <p class="center"> или class содержит токен 'center' — считаем за центрирование
    if (el.tagName === 'P') {
      const cls = el.getAttribute('class') ?? '';
      if (/\bcenter\b/i.test(cls) && !/\bfn-inline\b/.test(cls)) {
        const prev = el.getAttribute('style') ?? '';
        if (!/text-align/i.test(prev)) {
          el.setAttribute(
            'style',
            prev ? `${prev};text-align:center` : 'text-align:center',
          );
        }
      }
    }

    // Переименование тега если нужно.
    const renameTo = RENAME_TAG[el.tagName];
    if (renameTo) {
      const fresh = doc.createElement(renameTo.toLowerCase());
      // Атрибуты — копируем, потом sanitize отфильтрует.
      for (const attr of Array.from(el.attributes)) {
        fresh.setAttribute(attr.name, attr.value);
      }
      while (el.firstChild) fresh.appendChild(el.firstChild);
      el.replaceWith(fresh);
      el = fresh;
    }

    // Если тег не в whitelist — раздеваем (содержимое поднимаем выше).
    if (!KEEP_TAGS.has(el.tagName)) {
      cleanNode(el, doc);
      unwrap(el);
      continue;
    }

    sanitizeAttrs(el);
    cleanNode(el, doc);
  }
}

function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) {
    el.remove();
    return;
  }
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

function sanitizeAttrs(el: HTMLElement): void {
  const allowed = ALLOWED_ATTRS[el.tagName] ?? [];
  for (const attr of Array.from(el.attributes)) {
    if (!allowed.includes(attr.name)) {
      el.removeAttribute(attr.name);
    }
  }

  // Style: оставляем только text-align:center (на <p> и <h3>).
  if (el.hasAttribute('style')) {
    const style = (el.getAttribute('style') ?? '').toLowerCase();
    if (/text-align\s*:\s*center/.test(style) &&
        (el.tagName === 'P' || el.tagName === 'H3')) {
      el.setAttribute('style', 'text-align:center');
    } else {
      el.removeAttribute('style');
    }
  }

  // class: только fn-inline разрешён.
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

  // id: только fn-N для сносок.
  if (el.hasAttribute('id')) {
    const id = el.getAttribute('id') ?? '';
    if (el.tagName === 'P' && /^fn-\d+$/.test(id)) {
      // оставляем
    } else {
      el.removeAttribute('id');
    }
  }
}

// Для случая «лента сносок» внутри редактора — пользователь нажал
// кнопку «сноска», в DOM был вставлен <sup data-fn-text="...">, теперь
// перед сабмитом мы хотим:
//  - пронумеровать sup'ы в порядке появления (1, 2, 3, …)
//  - после каждого абзаца, в котором есть sup, добавить
//    <p class="fn-inline" id="fn-N"><sup>N</sup> текст</p>
// Возвращает HTML с готовыми сносками. Если sup'ов нет — возвращает
// исходный html без изменений.
export function materializeFootnotes(html: string): string {
  if (!html || typeof window === 'undefined') return html;
  if (!html.includes('data-fn-text') && !html.includes('fn-ref')) return html;

  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const sups = Array.from(
    doc.body.querySelectorAll('sup.fn-ref, sup[data-fn-text]'),
  ) as HTMLElement[];
  if (sups.length === 0) return html;

  // Сначала собираем тексты в map по позиции, чтобы выкинуть существующие
  // <p class="fn-inline"> (они нужно перенумеровать).
  doc.body
    .querySelectorAll('p.fn-inline')
    .forEach((p) => p.remove());

  // Теперь нумеруем sup'ы и собираем footnotes для каждого top-level paragraph.
  const fnByParagraph = new Map<Element, Array<{ n: number; text: string }>>();
  let counter = 0;
  for (const sup of sups) {
    counter += 1;
    const n = counter;
    const text =
      sup.getAttribute('data-fn-text') ?? sup.textContent?.trim() ?? '';
    sup.setAttribute('class', 'fn-ref');
    sup.setAttribute('data-fn-id', String(n));
    sup.removeAttribute('data-fn-text');
    sup.textContent = String(n);

    // Найти top-level <p> предка.
    let p: Element | null = sup;
    while (p && p.parentElement && p.parentElement !== doc.body) {
      p = p.parentElement;
    }
    if (!p) continue;
    if (!fnByParagraph.has(p)) fnByParagraph.set(p, []);
    fnByParagraph.get(p)!.push({ n, text });
  }

  // Вставляем <p class="fn-inline"> сразу после каждого абзаца с сносками.
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
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
