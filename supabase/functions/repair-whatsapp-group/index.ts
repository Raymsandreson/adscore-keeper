const EXT = 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/repair-whatsapp-group';
const RAILWAY = 'https://adscore-keeper-production.up.railway.app/functions/repair-whatsapp-group';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const rawBody = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();

  // Parse para decidir roteamento
  let parsed: any = null;
  if (rawBody) {
    try { parsed = JSON.parse(rawBody); } catch { /* ignore */ }
  }

  const useRailway = parsed?.action === 'add_instances';
  const target = useRailway ? RAILWAY : EXT;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (useRailway) {
    const railwayKey = Deno.env.get('RAILWAY_API_KEY') ?? '';
    if (railwayKey) headers['x-api-key'] = railwayKey;
  } else {
    const externalKey = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') ?? '';
    headers['Authorization'] = `Bearer ${externalKey}`;
    headers['apikey'] = externalKey;
  }

  try {
    const resp = await fetch(target, { method: req.method, headers, body: rawBody });
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
