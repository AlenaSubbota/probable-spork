// ---------------------------------------------------------------
// Форматирование текста комментария: BB-коды + автоссылки + спойлеры.
// Возвращает safe HTML-строку (для dangerouslySetInnerHTML).
//
// Поддерживает:
//   [b], [i], [u], [s]
//   [spoiler]...[/spoiler]   → <details><summary>Спойлер…</summary>…</details>
//   [url]http…[/url], [url=http…]label[/url]
//   >!text!< (legacy Reddit-style spoiler из миграции на чапитифу)
//   голые URL в тексте
// ---------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Валидация URL — только http(s), без javascript: и data:.
function isSafeUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function commentToHtml(input: string): string {
  if (!input) return '';

  // 1. Экранируем HTML. Дальше работаем со строкой в которой нет тегов.
  let out = escapeHtml(input);

  // 2. Legacy spoiler >!text!<
  out = out.replace(
    /&gt;!([\s\S]+?)!&lt;/g,
    '<details class="comment-spoiler-inline"><summary>Спойлер</summary>$1</details>'
  );

  // 3. BBCode [spoiler]...[/spoiler]
  out = out.replace(
    /\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi,
    '<details class="comment-spoiler-inline"><summary>Спойлер</summary>$1</details>'
  );

  // 4. Формат [b] [i] [u] [s]
  out = out
    .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>')
    .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>')
    .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<u>$1</u>')
    .replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '<s>$1</s>');

  // 5. [url=href]label[/url] и [url]href[/url]
  out = out.replace(
    /\[url=(.+?)\]([\s\S]*?)\[\/url\]/gi,
    (_m, href, label) => {
      const clean = href.replace(/&amp;/g, '&');
      if (!isSafeUrl(clean)) return escapeHtml(label);
      return `<a href="${escapeHtml(clean)}" target="_blank" rel="noreferrer noopener">${label}</a>`;
    }
  );
  out = out.replace(
    /\[url\]([\s\S]*?)\[\/url\]/gi,
    (_m, href) => {
      const clean = href.replace(/&amp;/g, '&');
      if (!isSafeUrl(clean)) return escapeHtml(href);
      return `<a href="${escapeHtml(clean)}" target="_blank" rel="noreferrer noopener">${escapeHtml(clean)}</a>`;
    }
  );

  // 6. Автоссылки: голый http(s)://... в тексте → <a>
  // Осторожно: не трогаем то что уже внутри <a>, потому что мы прошли BBCode
  // первым, и голые URL остались только в свободном тексте.
  out = out.replace(
    /(^|[\s>])(https?:\/\/[^\s<]+)/g,
    (_m, pre, url) => {
      const clean = url.replace(/[),.!?;:]+$/, ''); // убираем хвостовую пунктуацию
      const tail = url.slice(clean.length);
      if (!isSafeUrl(clean)) return _m;
      // href + текст ссылки экранируем — без этого `"` в URL ломал атрибут
      // и допускал вставку произвольных аттрибутов (URL-парсер `new URL`
      // принимает `"` в path/query без ошибок).
      const safeHref = escapeHtml(clean);
      return `${pre}<a href="${safeHref}" target="_blank" rel="noreferrer noopener">${escapeHtml(clean)}</a>${escapeHtml(tail)}`;
    }
  );

  // 7. Переводы строк в <br> (комменты короткие, параграфы не нужны)
  out = out.replace(/\n/g, '<br>');

  return out;
}
