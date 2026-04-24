const EXT = 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/sync-whatsapp-recent';
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

  try {
    const resp = await fetch(EXT, { method: req.method, headers, body });
    const text = await resp.text();

    const contentType = resp.headers.get('content-type') ?? '';
    const looksLikeHtml = contentType.includes('text/html') || /^\s*<!DOCTYPE html>/i.test(text);

    if (!resp.ok || looksLikeHtml) {
      console.warn('[sync-whatsapp-recent] upstream returned invalid response:', JSON.stringify({
        status: resp.status,
        contentType,
        bodyPreview: text.slice(0, 200),
      }));

      return new Response(JSON.stringify({ success: false, error: `Upstream ${resp.status}` }), {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

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
