// Next.js instrumentation hook — fires once при старте серверного
// процесса (Node + Edge runtimes). Используем для валидации
// обязательных env-переменных: лучше упасть на старте контейнера,
// чем отдавать «белый экран» каждому SSR-запросу.

const REQUIRED_ENVS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const;

const RECOMMENDED_ENVS = [
  'NEXT_PUBLIC_AUTH_API_URL',
] as const;

export async function register() {
  // На клиенте этот файл не выполняется, но edge runtime его дёргает —
  // process.env в edge может быть пустым для приватных ключей. Здесь
  // нас интересуют только NEXT_PUBLIC_*, которые залиты в build-time.

  const missing: string[] = [];
  for (const key of REQUIRED_ENVS) {
    if (!process.env[key] || String(process.env[key]).trim() === '') {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    const msg = `[chaptify] Missing required env vars: ${missing.join(', ')}`;
    if (process.env.NODE_ENV === 'production') {
      // Падаем — иначе SSR будет валиться на каждом запросе с
      // непонятной supabase-ошибкой.
      throw new Error(msg);
    }
    console.error(msg);
  }

  for (const key of RECOMMENDED_ENVS) {
    if (!process.env[key]) {
      console.warn(`[chaptify] Recommended env var not set: ${key}`);
    }
  }
}
