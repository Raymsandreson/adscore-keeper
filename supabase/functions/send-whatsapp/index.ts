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

    const resp = await fetch(target, {
      method: req.method,
      headers: fwdHeaders,
      body,
    });

    const text = await resp.text();
    return new Response(text, {
      status: resp.status,
      headers: {
        ...cors,
        'Content-Type': resp.headers.get('content-type') || 'application/json',
      },
    });
  } catch (err) {
    console.error('[send-whatsapp proxy] error:', err);
    return new Response(
      JSON.stringify({
        error: 'proxy_failed',
        message: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 502,
        headers: { ...cors, 'Content-Type': 'application/json' },
      },
    );
  }
});
