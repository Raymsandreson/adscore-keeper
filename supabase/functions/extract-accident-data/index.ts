// Proxy → Supabase Externo (kmedldlepwiityjsdahz)
// Migrado em 2026-04-30. Função self-contained (AI Gateway + Firecrawl, sem DB).
// Validação: payloads idênticos retornam {success: true, data: {...}} em ambos.
// Rollback: git restore deste arquivo + redeploy.
const EXT = 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/extract-accident-data';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
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
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();

    console.log(`[extract-accident-data ${requestId}] PROXY → externo (bodyLen=${body?.length ?? 0})`);

    const resp = await fetch(EXT, {
      method: req.method,
      headers: {
        'Content-Type': req.headers.get('content-type') || 'application/json',
        'x-request-id': requestId,
      },
      body,
    });

    const text = await resp.text();
    const duration = Date.now() - startTime;
    console.log(`[extract-accident-data ${requestId}] ← status=${resp.status} duration=${duration}ms`);

    if (resp.status >= 400) {
      console.error(`[extract-accident-data ${requestId}] ERROR BODY: ${text.substring(0, 500)}`);
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
    console.error(`[extract-accident-data proxy ${requestId}] CRITICAL:`, errorMsg);
    // HTTP 200 + success:false (regra do projeto: edges nunca retornam 5xx pra business logic)
    return new Response(
      JSON.stringify({ success: false, error: 'proxy_failed: ' + errorMsg, request_id: requestId }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json', 'x-request-id': requestId } },
    );
  }
});
