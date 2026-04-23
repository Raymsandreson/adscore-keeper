const EXT = 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/sync-whatsapp-recent';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();

  // Forward auth + apikey so the external function authorizes the request.
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const auth = req.headers.get('authorization');
  const apikey = req.headers.get('apikey');
  if (auth) headers['Authorization'] = auth;
  if (apikey) headers['apikey'] = apikey;

  const resp = await fetch(EXT, { method: req.method, headers, body });
  return new Response(await resp.text(), {
    status: resp.status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});
