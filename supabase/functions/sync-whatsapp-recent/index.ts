const EXT = 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/sync-whatsapp-recent';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const body = await req.text();
  const resp = await fetch(EXT, { method: req.method, headers: { 'Content-Type': 'application/json' }, body });
  return new Response(await resp.text(), { status: resp.status, headers: { ...cors, 'Content-Type': 'application/json' } });
});
