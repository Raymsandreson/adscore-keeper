// Proxy → Supabase Externo (kmedldlepwiityjsdahz)
// Migrado em 2026-04-30. callface-register já cadastra webhook DIRETO no Externo,
// então essa função Cloud existe apenas como fallback HTTP retrocompatível.
// Antes da migração: usava resolveSupabaseUrl() que já apontava pro Externo
// quando EXTERNAL_SUPABASE_URL estava setado — comportamento idêntico.
// Rollback: git restore deste arquivo + redeploy.
const EXT = 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/callface-webhook';

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
    const url = new URL(req.url);
    const target = EXT + (url.search || '');

    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();

    console.log(`[callface-webhook ${requestId}] PROXY → bodyLen=${body?.length ?? 0}`);

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
    console.log(`[callface-webhook ${requestId}] ← status=${resp.status} duration=${duration}ms`);

    if (resp.status >= 400) {
      console.error(`[callface-webhook ${requestId}] ERROR BODY: ${text.substring(0, 500)}`);
    }

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
    console.error(`[callface-webhook proxy ${requestId}] CRITICAL:`, errorMsg);
    // HTTP 200 + payload de erro (regra do projeto)
    return new Response(
      JSON.stringify({ success: false, error: 'proxy_failed: ' + errorMsg, request_id: requestId }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json', 'x-request-id': requestId } },
    );
  }
});
