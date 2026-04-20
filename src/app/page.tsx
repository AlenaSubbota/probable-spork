import { supabaseServer } from '@/lib/supabase/server';

export default async function Home() {
  const sb = await supabaseServer();
  // Пробуем получить 5 новелл из существующей базы
  const { data, error } = await sb.from('novels_view').select('id,title').limit(5);
  
  return (
    <main className="p-8 font-sans">
      <h1 className="text-2xl font-bold mb-4">Chaptify Test Connection</h1>
      <pre className="bg-gray-100 p-4 rounded-lg overflow-auto">
        {JSON.stringify({ data, error }, null, 2)}
      </pre>
    </main>
  );
}