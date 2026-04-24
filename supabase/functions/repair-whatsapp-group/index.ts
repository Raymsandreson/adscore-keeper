const EXT = 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/repair-whatsapp-group';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();
  const externalKey = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') ?? '';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${externalKey}`,
    'apikey': externalKey,
  };

  try {
    const resp = await fetch(EXT, { method: req.method, headers, body });
    const text = await resp.text();
    return new Response(text, {
      status: resp.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ success: false, error: `Proxy failed: ${msg}` }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
