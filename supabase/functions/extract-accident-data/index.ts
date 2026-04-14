const EXT = 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/extract-accident-data';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const body = await req.text();
  const resp = await fetch(EXT, { method: req.method, headers: { 'Content-Type': 'application/json' }, body });
  return new Response(await resp.text(), { status: resp.status, headers: { ...cors, 'Content-Type': 'application/json' } });
});
