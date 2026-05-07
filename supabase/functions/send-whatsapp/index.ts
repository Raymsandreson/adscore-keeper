// Proxy stub → Supabase externo (kmedldlepwiityjsdahz)
const EXT = 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/send-whatsapp';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-request-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Expose-Headers': 'x-request-id',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const summarizePayload = (raw?: string) => {
  if (!raw) return null;
  try {
    const body = JSON.parse(raw);
    return {
      phoneLast4: typeof body.phone === 'string' ? body.phone.replace(/\D/g, '').slice(-4) : null,
      chatIdSuffix: typeof body.chat_id === 'string' ? body.chat_id.slice(-12) : null,
      messageLength: typeof body.message === 'string' ? body.message.length : null,
      hasContactId: Boolean(body.contact_id),
      hasLeadId: Boolean(body.lead_id),
      instanceId: body.instance_id || null,
    };
  } catch {
    return { unparseableBodyLength: raw.length };
  }
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors });
  }

  try {
    // Preserva querystring da chamada original
    const url = new URL(req.url);
    const target = EXT + (url.search || '');

    // Logs detalhados para diagnóstico de 503
    // Usa x-request-id do cliente quando presente para correlacionar logs end-to-end
    const incomingRid = req.headers.get('x-request-id');
    const requestId = incomingRid || crypto.randomUUID();
    const startTime = Date.now();
    console.log(`[send-whatsapp ${requestId}] INCOMING → method=${req.method}, querystring=${url.search || '(none)'}, target=${target}, clientRid=${incomingRid || '(none)'}`);

    // Lê body apenas em métodos que podem tê-lo
    const body =
      req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();
    console.log(`[send-whatsapp ${requestId}] PAYLOAD SUMMARY → ${JSON.stringify(summarizePayload(body))}`);

    // Encaminha headers úteis (Authorization + apikey + content-type + request-id)
    const fwdHeaders: Record<string, string> = {
      'Content-Type': req.headers.get('content-type') || 'application/json',
      'x-request-id': requestId,
    };
    const auth = req.headers.get('authorization');
    if (auth) fwdHeaders['Authorization'] = auth;
    const apikey = req.headers.get('apikey');
    if (apikey) fwdHeaders['apikey'] = apikey;

    console.log(`[send-whatsapp ${requestId}] PROXYING → headers=${Object.keys(fwdHeaders).join(',')}`);

    const resp = await fetch(target, {
      method: req.method,
      headers: fwdHeaders,
      body,
    });

    const duration = Date.now() - startTime;
    const text = await resp.text();

    // Log do status retornado para diagnóstico rápido
    console.log(`[send-whatsapp ${requestId}] RESPONSE ← status=${resp.status}, statusText="${resp.statusText}", duration=${duration}ms, bodyLength=${text.length}`);
    console.log(`[send-whatsapp ${requestId}] RESPONSE BODY SUMMARY ← ${text.substring(0, 350)}${text.length > 350 ? '...(truncated)' : ''}`);

    // Se for erro 5xx ou 4xx, loga o corpo da resposta para debug
    if (resp.status >= 400) {
      console.error(`[send-whatsapp ${requestId}] ERROR BODY ← ${text.substring(0, 500)}${text.length > 500 ? '...(truncated)' : ''}`);
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
    const ridForError = (req.headers.get('x-request-id')) || 'unknown';
    console.error(`[send-whatsapp proxy ${ridForError}] CRITICAL ERROR:`, errorMsg);
    console.error(`[send-whatsapp proxy ${ridForError}] stack:`, err instanceof Error ? err.stack : 'no stack');
    return new Response(
      JSON.stringify({
        error: 'proxy_failed',
        message: errorMsg,
        request_id: ridForError,
      }),
      {
        status: 502,
        headers: { ...cors, 'Content-Type': 'application/json', 'x-request-id': ridForError },
      },
    );
  }
});
