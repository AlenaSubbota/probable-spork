// -----------------------------------------------------------
// Импорт глав из .docx-файлов и из rich-text-буфера обмена
// (Word, Google Docs, Pages). Возвращаем уже BB-код, чтобы
// дальше форма работала по своему обычному пути BB → HTML.
//
// Что важно сохранить: курсив, жирный, центрирование. Всё это
// — основные инструменты переводчика в Word.
// -----------------------------------------------------------

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
// превращает их в <p class="center">. Дальше htmlToBb это понимает.
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

export async function docxToBb(file: File | Blob): Promise<string> {
  const mammoth = await loadMammoth();
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      transformDocument: mammoth.transforms.paragraph(transformParagraph),
      styleMap: STYLE_MAP,
    },
  );
  return htmlToBb(result.value);
}

// Для onPaste: clipboard выдаёт html-фрагмент (без <html>/<body>).
// Прогоняем через тот же htmlToBb. Возвращаем null, если bb пустой —
// тогда вызывающий код может откатиться к стандартному paste plain-text.
export function htmlClipboardToBb(html: string): string | null {
  if (!html || !html.trim()) return null;
  const bb = htmlToBb(html).trim();
  return bb || null;
}
