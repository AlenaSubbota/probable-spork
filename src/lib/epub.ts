import JSZip from 'jszip';

// Минимальный EPUB 2.0 generator. Принимает метаданные новеллы + массив
// глав и возвращает Buffer с готовым .epub. Используется в
// /api/novel/[id]/epub для on-demand выдачи по уровню доступа читателя.

export interface EpubChapter {
  number: number;
  title: string;
  /** HTML-тело главы (из chapter_content bucket) */
  html: string;
}

export interface EpubInput {
  novelTitle: string;
  authorName: string;           // имя переводчика или автора оригинала
  coverBytes: Uint8Array | null; // jpg/png байты или null
  coverContentType: string | null;
  language: string;             // 'ru' / 'en' / ...
  identifier: string;           // uniq id книги (firebase_id + tier)
  chapters: EpubChapter[];
  tierLabel: string;            // «Все главы», «Бесплатные», etc — уходит в subtitle
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Очищает HTML от скриптов/стилей и оборачивает в xhtml shell.
function chapterXhtml(title: string, html: string): string {
  const clean = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    // убираем самозакрытые невалидные теги
    .replace(/<(br|img|hr)([^>]*)>/gi, '<$1$2/>');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ru">
<head>
  <title>${escapeXml(title)}</title>
  <meta http-equiv="Content-Type" content="application/xhtml+xml; charset=utf-8"/>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <h1>${escapeXml(title)}</h1>
  ${clean}
</body>
</html>`;
}

const CSS = `
body { font-family: serif; line-height: 1.6; padding: 0 1em; }
h1 { font-size: 1.4em; margin: 1em 0; border-bottom: 1px solid #ccc; padding-bottom: .3em; }
p { margin: .6em 0; text-indent: 1.2em; }
blockquote { border-left: 3px solid #ccc; padding-left: 1em; color: #555; font-style: italic; }
`.trim();

export async function buildEpub(input: EpubInput): Promise<Uint8Array> {
  const zip = new JSZip();

  // mimetype — первым и uncompressed (требование EPUB)
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  // META-INF/container.xml
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );

  // Главы
  const manifestItems: string[] = [];
  const spineItems: string[] = [];
  const tocItems: string[] = [];
  let playOrder = 1;

  for (const ch of input.chapters) {
    const id = `ch${ch.number}`;
    const href = `${id}.xhtml`;
    zip.file(`OEBPS/${href}`, chapterXhtml(ch.title, ch.html));
    manifestItems.push(
      `<item id="${id}" href="${href}" media-type="application/xhtml+xml"/>`
    );
    spineItems.push(`<itemref idref="${id}"/>`);
    tocItems.push(
      `<navPoint id="nav-${id}" playOrder="${playOrder++}">
        <navLabel><text>${escapeXml(ch.title)}</text></navLabel>
        <content src="${href}"/>
      </navPoint>`
    );
  }

  // style.css
  zip.file('OEBPS/style.css', CSS);

  // Обложка (опционально)
  let coverManifestExtra = '';
  let coverMetaExtra = '';
  if (input.coverBytes && input.coverContentType) {
    const ext = input.coverContentType.includes('png') ? 'png' : 'jpg';
    zip.file(`OEBPS/cover.${ext}`, input.coverBytes);
    coverManifestExtra = `<item id="cover-image" href="cover.${ext}" media-type="${input.coverContentType}" properties="cover-image"/>`;
    coverMetaExtra = `<meta name="cover" content="cover-image"/>`;
  }

  // content.opf
  const now = new Date().toISOString();
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${escapeXml(input.novelTitle)}</dc:title>
    <dc:creator opf:role="aut">${escapeXml(input.authorName)}</dc:creator>
    <dc:language>${escapeXml(input.language)}</dc:language>
    <dc:identifier id="BookId">urn:chaptify:${escapeXml(input.identifier)}</dc:identifier>
    <dc:date>${now}</dc:date>
    <dc:description>${escapeXml(input.tierLabel)} · собрано ${now.slice(0, 10)} на chaptify.ru</dc:description>
    ${coverMetaExtra}
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
    ${coverManifestExtra}
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine toc="ncx">
    ${spineItems.join('\n    ')}
  </spine>
</package>`;
  zip.file('OEBPS/content.opf', opf);

  // toc.ncx
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:chaptify:${escapeXml(input.identifier)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(input.novelTitle)}</text></docTitle>
  <navMap>
    ${tocItems.join('\n    ')}
  </navMap>
</ncx>`;
  zip.file('OEBPS/toc.ncx', ncx);

  return await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
