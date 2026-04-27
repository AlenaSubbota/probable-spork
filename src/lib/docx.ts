// -----------------------------------------------------------
// Импорт глав из .docx-файлов и из rich-text-буфера обмена
// (Word, Google Docs, Pages).
//
// Главный путь — HTML-вывод (docxToHtml / htmlClipboardToHtml),
// он используется новым WYSIWYG-редактором главы (RichTextEditor).
//
// Legacy-путь — BB-вывод (docxToBb / htmlClipboardToBb), нужен
// старому BBCodeEditor: NovelForm и NewsForm всё ещё на нём
// (короткие описания, BB удобнее). Удалить эти алиасы можно
// будет только если вместе с ними переписать NovelForm/NewsForm.
// -----------------------------------------------------------

import { cleanHtml } from './sanitize';
import { htmlToBb } from './bbcode';

// Типы из mammoth достаточно «свободные», подгружается динамически,
// чтобы не утяжелять основной бандл администраторской формой.
type MammothModule = {
  convertToHtml: (
    input: { arrayBuffer: ArrayBuffer },
    options?: Record<string, unknown>,
  ) => Promise<{ value: string; messages: unknown[] }>;
  transforms: {
    paragraph: (
      fn: (p: Record<string, unknown>) => Record<string, unknown>,
    ) => unknown;
  };
};

let mammothPromise: Promise<MammothModule> | null = null;
function loadMammoth(): Promise<MammothModule> {
  if (!mammothPromise) {
    mammothPromise = import('mammoth/mammoth.browser') as unknown as Promise<MammothModule>;
  }
  return mammothPromise;
}

// Mammoth по умолчанию игнорирует выравнивание абзацев (это известное
// ограничение). Чиним руками: в transformDocument помечаем абзацы
// с alignment='center' классом-стилем 'Centered', а потом styleMap
// превращает их в <p class="center">. Дальше cleanHtml превращает
// это в <p style="text-align:center">.
const STYLE_MAP = [
  "p[style-name='Centered'] => p.center:fresh",
  "p[style-name='Center'] => p.center:fresh",
  "p[style-name='По центру'] => p.center:fresh",
];

function transformParagraph(
  paragraph: Record<string, unknown>,
): Record<string, unknown> {
  const alignment = paragraph.alignment as string | undefined;
  const styleId = paragraph.styleId as string | undefined;
  if (alignment === 'center' && !styleId) {
    return { ...paragraph, styleId: 'Centered', styleName: 'Centered' };
  }
  return paragraph;
}

async function docxToCleanHtml(file: File | Blob): Promise<string> {
  const mammoth = await loadMammoth();
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      transformDocument: mammoth.transforms.paragraph(transformParagraph),
      styleMap: STYLE_MAP,
    },
  );
  return cleanHtml(result.value);
}

export async function docxToHtml(file: File | Blob): Promise<string> {
  return docxToCleanHtml(file);
}

// Для onPaste из Word/Google Docs: clipboard выдаёт html-фрагмент
// (без <html>/<body>). Прогоняем через cleanHtml, чтобы убрать
// MsoNormal-классы, span'ы с inline-шрифтами, цвета, размеры —
// в редактор попадает только разрешённый набор тегов.
export function htmlClipboardToHtml(html: string): string | null {
  if (!html || !html.trim()) return null;
  const cleaned = cleanHtml(html).trim();
  return cleaned || null;
}

// ---- Legacy: BB-вывод для старого BBCodeEditor ----
//
// Возвращают BB-код вместо HTML. Нужны NovelForm/NewsForm — они
// хранят текст в BB-формате (textarea + bbToHtml на сабмите).
// Внутренне идут через тот же mammoth/cleanHtml, потом конвертируют
// в BB через htmlToBb.

export async function docxToBb(file: File | Blob): Promise<string> {
  const html = await docxToCleanHtml(file);
  return htmlToBb(html);
}

export function htmlClipboardToBb(html: string): string | null {
  if (!html || !html.trim()) return null;
  const cleaned = cleanHtml(html);
  const bb = htmlToBb(cleaned).trim();
  return bb || null;
}
