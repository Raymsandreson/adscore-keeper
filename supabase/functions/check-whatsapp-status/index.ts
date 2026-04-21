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

    const contentType = resp.headers.get('content-type') ?? '';
    const looksLikeHtml = contentType.includes('text/html') || /^\s*<!DOCTYPE html>/i.test(text);

    if (!resp.ok || looksLikeHtml) {
      console.warn('[check-whatsapp-status] upstream returned invalid response:', JSON.stringify({
        status: resp.status,
        contentType,
        looksLikeHtml,
      }));

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    return new Response(text, {
      status: resp.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    clearTimeout(timeoutId);
    const isAbort = e instanceof Error && e.name === 'AbortError';
    // Return empty array so the UI's .map() doesn't crash
    console.warn('[check-whatsapp-status] upstream failed:', isAbort ? 'timeout' : (e instanceof Error ? e.message : String(e)));
    return new Response(
      JSON.stringify([]),
      {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
      },
    );
  }
});
