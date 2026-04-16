import { corsHeaders } from '@supabase/supabase-js/cors'

const EXT_URL = 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/extract-accident-data';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.text();

    const resp = await fetch(EXT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    const respText = await resp.text();

    return new Response(respText, {
      status: resp.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Proxy error:', err);
    return new Response(
      JSON.stringify({ error: 'Proxy error: ' + (err instanceof Error ? err.message : String(err)) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
