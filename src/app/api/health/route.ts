import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

// Healthcheck для docker compose / nginx / load balancer'а.
// Возвращает 200 если процесс жив И supabase отвечает на лёгкий
// SELECT, 503 если supabase недоступен. JSON-ответ короткий, чтобы
// эндпоинт можно было опрашивать раз в секунду без расходов.
//
// Использование:
//   docker-compose.yml:
//     healthcheck:
//       test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"]
//       interval: 30s
//       timeout: 5s
//       retries: 3
//
// Этот endpoint НЕ должен включать чувствительную информацию о
// конфиге/версиях — отдаём только {ok, ts, db}.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const ts = new Date().toISOString();

  // Лёгкий ping в Supabase — SELECT 1 через RPC catalog или просто
  // count чего-нибудь публичного. В нашем случае — count(novels) с
  // limit 0 (выполняет EXPLAIN-style проверку без выборки строк).
  let dbOk = false;
  let dbError: string | null = null;
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from('novels')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    if (!error) dbOk = true;
    else dbError = error.message;
  } catch (e) {
    dbError = e instanceof Error ? e.message : 'unknown';
  }

  const status = dbOk ? 200 : 503;
  return NextResponse.json(
    {
      ok: dbOk,
      ts,
      db: dbOk ? 'ok' : 'down',
      ...(dbError ? { error: dbError } : {}),
    },
    {
      status,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
