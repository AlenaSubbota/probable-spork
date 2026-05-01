// Превращаем raw-сообщение PostgREST/Postgres в человеко-понятный
// текст. Юзер не должен видеть «duplicate key value violates unique
// constraint chapters_pkey» — он должен видеть «Глава с этим номером
// уже существует».
//
// Используется в админ-формах (NovelForm, ChapterForm и т.д.). Если
// код ошибки неизвестен — отдаём оригинальное message с префиксом
// «Что-то пошло не так:» — это лучше, чем молча падать без feedback'а.

interface PgErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

// Ключевые слова из текста ошибки → дружелюбное сообщение. Используется
// как fallback, если PG-код не распознан, но текст содержит знакомый
// маркер.
const TEXT_HEURISTICS: Array<{ re: RegExp; msg: string }> = [
  // Дубликаты
  { re: /duplicate key value/i, msg: 'Такая запись уже существует.' },
  { re: /already exists/i, msg: 'Уже существует.' },

  // Длина
  { re: /value too long/i, msg: 'Слишком длинное значение в одном из полей.' },
  { re: /string data, right truncation/i, msg: 'Слишком длинный текст в поле.' },

  // NULL
  { re: /null value in column "(\w+)"/i, msg: 'Не заполнено обязательное поле.' },
  { re: /violates not-null constraint/i, msg: 'Не заполнено обязательное поле.' },

  // FK
  { re: /violates foreign key constraint/i, msg: 'Не нашлась связанная запись (например, переводчик или новелла удалены).' },

  // Check constraint
  { re: /violates check constraint/i, msg: 'Значение не подходит — проверь поле и попробуй снова.' },

  // RLS / разрешения
  { re: /permission denied/i, msg: 'Недостаточно прав для этого действия.' },
  { re: /new row violates row-level security policy/i, msg: 'Недостаточно прав для этого действия.' },

  // Сеть / таймаут
  { re: /failed to fetch/i, msg: 'Сеть отвалилась — попробуй ещё раз.' },
  { re: /network/i, msg: 'Сеть отвалилась — попробуй ещё раз.' },
];

// PG SQLSTATE → краткое объяснение
const CODE_MAP: Record<string, string> = {
  '23505': 'Такая запись уже существует.',
  '23503': 'Не нашлась связанная запись.',
  '23502': 'Не заполнено обязательное поле.',
  '23514': 'Значение не подходит по правилам базы — проверь поля.',
  '22001': 'Слишком длинное значение в одном из полей.',
  '22023': 'Некорректное значение параметра.',
  '42501': 'Недостаточно прав для этого действия.',
  'PGRST301': 'Сессия истекла, войди заново.',
};

export function friendlyError(err: unknown, fallbackVerb?: string): string {
  if (!err) return 'Что-то пошло не так.';

  // Поддерживаем как чистый Error, так и PostgrestError-подобный объект.
  const e: PgErrorLike =
    typeof err === 'object' && err !== null
      ? (err as PgErrorLike)
      : { message: String(err) };

  const code = (e.code ?? '').toString();
  if (code && CODE_MAP[code]) {
    return prefix(fallbackVerb, CODE_MAP[code]);
  }

  const text = `${e.message ?? ''} ${e.details ?? ''} ${e.hint ?? ''}`.trim();
  for (const { re, msg } of TEXT_HEURISTICS) {
    if (re.test(text)) return prefix(fallbackVerb, msg);
  }

  // Неизвестная ошибка — отдаём короткий fallback, не голый PG-text.
  // Если очень хочется отлаживать — message всё равно есть в console
  // (сюда мы попадаем после .rpc() и лог сам пишется в DevTools).
  if (typeof process !== 'undefined' && typeof console !== 'undefined') {
    // eslint-disable-next-line no-console
    console.warn('[friendlyError] unmapped error:', err);
  }

  const generic = e.message?.trim() || 'Что-то пошло не так.';
  return prefix(fallbackVerb, generic);
}

function prefix(verb: string | undefined, msg: string): string {
  return verb ? `Не удалось ${verb}: ${msg}` : msg;
}
