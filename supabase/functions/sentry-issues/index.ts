// Proxy → Supabase Externo (kmedldlepwiityjsdahz)
// Migrado em 2026-04-30. Função self-contained (Sentry API, sem DB).
// MOTIVO EXTRA: SENTRY_AUTH_TOKEN no Cloud está expirado/inválido (401).
// Externo já tem token válido — proxy CONSERTA a função.
// Rollback: git restore deste arquivo + redeploy.
const EXT = 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/sentry-issues';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Expose-Headers': 'x-request-id',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors });
  }

  const incomingRid = req.headers.get('x-request-id');
  const requestId = incomingRid || crypto.randomUUID();
  const startTime = Date.now();

  try {
    // Preserva querystring (?endpoint=, ?statsPeriod=, ?issueId=, etc.)
    const url = new URL(req.url);
    const target = EXT + (url.search || '');

    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();

    console.log(`[sentry-issues ${requestId}] PROXY → ${url.search || '(no qs)'}`);

    const fwdHeaders: Record<string, string> = {
      'Content-Type': req.headers.get('content-type') || 'application/json',
      'x-request-id': requestId,
    };
    const auth = req.headers.get('authorization');
    if (auth) fwdHeaders['Authorization'] = auth;
    const apikey = req.headers.get('apikey');
    if (apikey) fwdHeaders['apikey'] = apikey;

    const resp = await fetch(target, {
      method: req.method,
      headers: fwdHeaders,
      body,
    });

    const text = await resp.text();
    const duration = Date.now() - startTime;
    console.log(`[sentry-issues ${requestId}] ← status=${resp.status} duration=${duration}ms bytes=${text.length}`);

    return new Response(text, {
      status: resp.status,
      headers: {
        ...cors,
        'Content-Type': resp.headers.get('content-type') || 'application/json',
        'x-request-id': requestId,
      },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[sentry-issues proxy ${requestId}] CRITICAL:`, errorMsg);
    return new Response(
      JSON.stringify({ error: 'proxy_failed', details: errorMsg, request_id: requestId }),
      { status: 502, headers: { ...cors, 'Content-Type': 'application/json', 'x-request-id': requestId } },
    );
  }
});
