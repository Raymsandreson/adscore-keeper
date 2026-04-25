const EXT = 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/sync-user-to-external';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Expose-Headers': 'x-request-id',
};

Deno.serve(async (req) => {
  const rid = req.headers.get('x-request-id') || crypto.randomUUID();

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors });
  }

  // Read body only for methods that have one
  let body: string | undefined;
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      body = await req.text();
    }
  } catch (e) {
    console.error(`[sync-user-to-external ${rid}] body read failed:`, e);
    body = undefined;
  }

  const externalKey = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const fwdHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-request-id': rid,
  };
  // Forward caller auth if present, else use external service role
  const auth = req.headers.get('authorization');
  if (auth) fwdHeaders['Authorization'] = auth;
  else if (externalKey) fwdHeaders['Authorization'] = `Bearer ${externalKey}`;
  if (externalKey) fwdHeaders['apikey'] = externalKey;

  // Hard timeout to avoid 150s IDLE_TIMEOUT
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  console.log(`[sync-user-to-external ${rid}] → ${req.method} ${EXT} (body=${body?.length ?? 0}b)`);

  try {
    const resp = await fetch(EXT, {
      method: req.method,
      headers: fwdHeaders,
      body,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const text = await resp.text();
    console.log(`[sync-user-to-external ${rid}] ← status=${resp.status}`);
    return new Response(text, {
      status: resp.status,
      headers: { ...cors, 'Content-Type': 'application/json', 'x-request-id': rid },
    });
  } catch (err: any) {
    clearTimeout(timeoutId);
    const isTimeout = err?.name === 'AbortError';
    console.error(`[sync-user-to-external ${rid}] proxy error:`, err?.message || err);
    return new Response(
      JSON.stringify({
        error: isTimeout ? 'external_timeout' : 'external_error',
        message: err?.message || String(err),
        requestId: rid,
      }),
      {
        status: isTimeout ? 504 : 502,
        headers: { ...cors, 'Content-Type': 'application/json', 'x-request-id': rid },
      },
    );
  }
});
