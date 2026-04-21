// -----------------------------------------------------------
// Типы и константы для админки.
// -----------------------------------------------------------

export type Country = 'kr' | 'cn' | 'jp' | 'other';

export const COUNTRY_LABELS: Record<Country, string> = {
  kr: 'Корея',
  cn: 'Китай',
  jp: 'Япония',
  other: 'Другая',
};

export type AgeRating = '6+' | '12+' | '16+' | '18+';
export const AGE_RATINGS: AgeRating[] = ['6+', '12+', '16+', '18+'];

export type TranslationStatus = 'ongoing' | 'completed' | 'frozen' | 'abandoned';
export const TRANSLATION_STATUS_LABELS: Record<TranslationStatus, string> = {
  ongoing: 'Продолжается',
  completed: 'Завершён',
  frozen: 'Заморожен',
  abandoned: 'Заброшен',
};

export type ModerationStatus = 'draft' | 'pending' | 'published' | 'rejected';
export const MODERATION_LABELS: Record<ModerationStatus, string> = {
  draft: 'Черновик',
  pending: 'На модерации',
  published: 'Опубликовано',
  rejected: 'Отклонено',
};
// tone: для CSS-класса (цветная плашка)
export const MODERATION_TONE: Record<ModerationStatus, 'muted' | 'gold' | 'leaf' | 'rose'> = {
  draft: 'muted',
  pending: 'gold',
  published: 'leaf',
  rejected: 'rose',
};

// Единый список жанров — переводчики могут только выбирать из него.
// Добавление произвольных жанров запрещено, чтобы не было разнобоя.
export const PREDEFINED_GENRES = [
  // Основные
  'Романтика',
  'Фэнтези',
  'Ромфэнтези',
  'Фантастика',
  'Научная фантастика',
  'Постапокалипсис',
  'Киберпанк',
  'Стимпанк',

  // Эмоция
  'Драма',
  'Мелодрама',
  'Трагедия',
  'Комедия',
  'Романтическая комедия',

  // Действие
  'Экшен',
  'Приключения',
  'Боевые искусства',
  'Триллер',

  // Интеллект
  'Психология',
  'Мистика',
  'Детектив',
  'Ужасы',
  'Философия',

  // Быт
  'Повседневность',
  'Слайс',
  'Школа',
  'Спорт',
  'Кулинария',

  // Восточные специфики
  'Сянься',
  'Уся',
  'Культивация',
  'Реинкарнация',
  'Исэкай',
  'Портал в другой мир',
  'Сёдзё',
  'Сэйнэн',
  'Дзёсэй',
  'Сёнэн',

  // Исторические / сеттинги
  'Историческое',
  'Восточная древность',
  'Магическая академия',
  'Империя',
  'Гарем',
  'Обратный гарем',

  // Другие
  'Пародия',
  'Сатира',
  'Музыка',
  'Искусство',
  'LitRPG',
  'Игровые миры',
];

export type GlossaryCategory = 'character' | 'place' | 'term' | 'technique' | 'other';

export const GLOSSARY_CATEGORIES: Record<GlossaryCategory, string> = {
  character: 'Персонаж',
  place: 'Место',
  term: 'Термин',
  technique: 'Техника/способность',
  other: 'Прочее',
};

// -----------------------------------------------------------
// Утилиты для текстовой статистики (killer #3)
// -----------------------------------------------------------

export interface ChapterStats {
  chars: number;
  words: number;
  paragraphs: number;
  readingMinutes: number;
  topRepeats: { word: string; count: number }[];
  longSentenceCount: number;
  longSentenceThreshold: number;
}

// Стоп-слова, которые игнорируются в подсчёте повторов
const STOP_WORDS = new Set([
  'и','в','во','не','что','он','на','я','с','со','как','а','то','все','она',
  'так','его','но','да','ты','к','у','же','вы','за','бы','по','только','ее',
  'её','мне','было','вот','от','меня','ещё','еще','нет','о','из','ему','теперь',
  'когда','даже','ну','вдруг','ли','если','уже','или','быть','был','него','до',
  'вас','нибудь','опять','уж','вам','ведь','там','потом','себя','ничего','ей',
  'может','они','тут','где','есть','надо','ней','для','мы','тебя','их','чем',
  'была','сам','чтоб','без','будто','чего','раз','тоже','себе','под','будет',
  'ж','тогда','кто','этот','того','потому','этого','какой','совсем','ним',
  'здесь','этом','один','почти','мой','тем','чтобы','нее','неё','были','куда',
  'зачем','всех','никогда','можно','при','наконец','два','об','другой','хоть',
  'после','над','больше','тот','через','эти','нас','про','всего','них','какая',
  'много','разве','три','эту','моя','впрочем','хорошо','свою','этой','перед',
  'иногда','лучше','чуть','том','нельзя','такой','им','более','всегда','конечно',
  'всю','между','the','a','an','and','or','but','of','to','in','on','at','is','was','it','he','she','they',
]);

export function computeChapterStats(
  html: string,
  longSentenceThreshold = 30
): ChapterStats {
  // Чистим теги, оставляем текст
  const text = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|blockquote|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[\t\r]+/g, ' ')
    .replace(/ +/g, ' ');

  const chars = text.replace(/\s/g, '').length;

  const tokens = (text.match(/[\p{L}'-]+/gu) ?? []).map((w) => w.toLowerCase());
  const words = tokens.length;

  const paragraphs = (html.match(/<p[\s>]/gi) ?? []).length || Math.max(1, text.split(/\n+/).filter(Boolean).length);

  const readingMinutes = Math.max(1, Math.round(words / 180)); // ~180 wpm

  // Повторы (вне стоп-слов, от 3 букв)
  const freq = new Map<string, number>();
  for (const w of tokens) {
    if (w.length < 3 || STOP_WORDS.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  const topRepeats = Array.from(freq.entries())
    .filter(([, c]) => c >= 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([word, count]) => ({ word, count }));

  // Длинные предложения
  const sentences = text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const longSentenceCount = sentences.filter((s) => {
    const wordCount = (s.match(/[\p{L}'-]+/gu) ?? []).length;
    return wordCount >= longSentenceThreshold;
  }).length;

  return { chars, words, paragraphs, readingMinutes, topRepeats, longSentenceCount, longSentenceThreshold };
}

// Простая транслитерация для fallback-генерации firebase_id
export function makeSlug(title: string): string {
  const map: Record<string, string> = {
    а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',к:'k',
    л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',
    ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
  };
  const lower = title.toLowerCase();
  let out = '';
  for (const ch of lower) {
    if (map[ch] !== undefined) out += map[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else if (/\s/.test(ch)) out += '-';
  }
  out = out.replace(/-+/g, '-').replace(/^-|-$/g, '');
  // Добавляем суффикс для уникальности
  const suffix = Math.random().toString(36).slice(2, 6);
  return out ? `${out}-${suffix}` : suffix;
}
