const EXT = 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/sync-whatsapp-recent';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const body = await req.text();
  const externalKey = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${externalKey}`,
    'apikey': externalKey,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const resp = await fetch(EXT, { method: req.method, headers, body, signal: controller.signal });
    clearTimeout(timeoutId);
    return new Response(await resp.text(), {
      status: resp.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    clearTimeout(timeoutId);
    const isAbort = e instanceof Error && e.name === 'AbortError';
    return new Response(
      JSON.stringify({
        success: false,
        error: isAbort ? 'upstream_timeout' : (e instanceof Error ? e.message : String(e)),
      }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }
});
