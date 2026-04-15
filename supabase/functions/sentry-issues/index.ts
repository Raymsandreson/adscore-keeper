const EXT = 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/sentry-issues';
const EXT_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImttZWRsZGxlcHdpaXR5anNkYWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzMzMjQ4ODQsImV4cCI6MjA0ODkwMDg4NH0.GFgMGvPzFySblkzyrJdKdOMbmfV0jbrO34GFAfNJkx4';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = new URL(req.url);
  const resp = await fetch(`${EXT}${url.search}`, {
    method: req.method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${EXT_ANON}`,
      'apikey': EXT_ANON,
    },
  });
  return new Response(await resp.text(), { status: resp.status, headers: { ...cors, 'Content-Type': 'application/json' } });
});
