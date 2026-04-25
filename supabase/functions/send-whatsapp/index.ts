// Proxy stub → Supabase externo (kmedldlepwiityjsdahz)
const EXT = 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/send-whatsapp';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
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
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    console.log(`[send-whatsapp ${requestId}] INCOMING → method=${req.method}, querystring=${url.search || '(none)'}, target=${target}`);

    // Lê body apenas em métodos que podem tê-lo
    const body =
      req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();

    // Encaminha headers úteis (Authorization + apikey + content-type)
    const fwdHeaders: Record<string, string> = {
      'Content-Type': req.headers.get('content-type') || 'application/json',
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

    // Se for erro 5xx ou 4xx, loga o corpo da resposta para debug
    if (resp.status >= 400) {
      console.error(`[send-whatsapp ${requestId}] ERROR BODY ← ${text.substring(0, 500)}${text.length > 500 ? '...(truncated)' : ''}`);
    }

    return new Response(text, {
      status: resp.status,
      headers: {
        ...cors,
        'Content-Type': resp.headers.get('content-type') || 'application/json',
      },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[send-whatsapp proxy] CRITICAL ERROR:', errorMsg);
    console.error('[send-whatsapp proxy] stack:', err instanceof Error ? err.stack : 'no stack');
    return new Response(
      JSON.stringify({
        error: 'proxy_failed',
        message: errorMsg,
      }),
      {
        status: 502,
        headers: { ...cors, 'Content-Type': 'application/json' },
      },
    );
  }
});
