// Next.js instrumentation hook — fires once при старте серверного
// процесса. Используем как мягкий валидатор env: только логируем,
// никогда не throw — иначе при первом промахе со переменной весь
// контейнер уходит в crash-loop, и сайт отдаёт 500 без шанса
// диагностики из консоли.

const REQUIRED_ENVS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const;

const RECOMMENDED_ENVS = [
  'NEXT_PUBLIC_AUTH_API_URL',
] as const;

export async function register() {
  // NEXT_PUBLIC_* инлайнятся в build-time, но через process.env они
  // тоже видны в node-рантайме. В edge-рантайме набор может быть
  // ограничен — поэтому только warn, не throw.
  const missing: string[] = [];
  for (const key of REQUIRED_ENVS) {
    if (!process.env[key] || String(process.env[key]).trim() === '') {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    console.error(`[chaptify] Missing required env vars: ${missing.join(', ')}`);
  }
  for (const key of RECOMMENDED_ENVS) {
    if (!process.env[key]) {
      console.warn(`[chaptify] Recommended env var not set: ${key}`);
    }
  }
}
