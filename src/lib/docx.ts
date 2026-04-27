// -----------------------------------------------------------
// Импорт глав из .docx-файлов и из rich-text-буфера обмена
// (Word, Google Docs, Pages). Возвращаем чистый HTML — он
// сразу годится и для contentEditable-редактора, и для
// сохранения в storage.
// -----------------------------------------------------------

import { cleanHtml } from './sanitize';

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

export async function docxToHtml(file: File | Blob): Promise<string> {
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

// Для onPaste из Word/Google Docs: clipboard выдаёт html-фрагмент
// (без <html>/<body>). Прогоняем через cleanHtml, чтобы убрать
// MsoNormal-классы, span'ы с inline-шрифтами, цвета, размеры —
// в редактор попадает только разрешённый набор тегов.
export function htmlClipboardToHtml(html: string): string | null {
  if (!html || !html.trim()) return null;
  const cleaned = cleanHtml(html).trim();
  return cleaned || null;
}
