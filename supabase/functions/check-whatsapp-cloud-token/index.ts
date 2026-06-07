// Proxy fino para Railway /functions/check-whatsapp-cloud-token.
// Retorna sempre HTTP 200 com payload de status (política do projeto).

const RAILWAY_URL = Deno.env.get('RAILWAY_URL') || 'https://adscore-keeper-production.up.railway.app';
const RAILWAY_API_KEY = Deno.env.get('RAILWAY_API_KEY') || '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (RAILWAY_API_KEY) headers['x-api-key'] = RAILWAY_API_KEY;

    const r = await fetch(`${RAILWAY_URL}/functions/check-whatsapp-cloud-token`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    const text = await r.text();
    return new Response(text, {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({
      success: false,
      status: 'unreachable',
      message: 'Railway indisponível',
      error: e instanceof Error ? e.message : String(e),
    }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
