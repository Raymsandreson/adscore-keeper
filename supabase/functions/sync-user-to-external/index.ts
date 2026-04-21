const EXT = 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/sync-user-to-external';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const body = await req.text();

  // Hard timeout to avoid 150s IDLE_TIMEOUT — if external is slow, fail fast
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s

  try {
    const resp = await fetch(EXT, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const text = await resp.text();
    return new Response(text, {
      status: resp.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    clearTimeout(timeoutId);
    const isTimeout = err?.name === 'AbortError';
    return new Response(
      JSON.stringify({
        error: isTimeout ? 'external_timeout' : 'external_error',
        message: err?.message || String(err),
      }),
      {
        status: isTimeout ? 504 : 502,
        headers: { ...cors, 'Content-Type': 'application/json' },
      },
    );
  }
});
