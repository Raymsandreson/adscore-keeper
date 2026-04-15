const EXT = 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/sentry-issues';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = new URL(req.url);
  const resp = await fetch(`${EXT}${url.search}`, { method: req.method, headers: { 'Content-Type': 'application/json' } });
  return new Response(await resp.text(), { status: resp.status, headers: { ...cors, 'Content-Type': 'application/json' } });
});
