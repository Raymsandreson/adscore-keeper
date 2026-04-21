const EXT = 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/check-whatsapp-status';
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

  // Abort upstream if it takes too long — avoid 150s edge runtime timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const resp = await fetch(EXT, { method: req.method, headers, body, signal: controller.signal });
    clearTimeout(timeoutId);
    const text = await resp.text();
    return new Response(text, {
      status: resp.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    clearTimeout(timeoutId);
    const isAbort = e instanceof Error && e.name === 'AbortError';
    // Return 200 with unknown status so the UI doesn't break the screen
    return new Response(
      JSON.stringify({
        status: 'unknown',
        connected: false,
        error: isAbort ? 'upstream_timeout' : (e instanceof Error ? e.message : String(e)),
      }),
      {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
      },
    );
  }
});
