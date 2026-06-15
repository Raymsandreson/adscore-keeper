import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const mask = (v?: string) => {
    if (!v) return { present: false, value: null };
    return { present: true, length: v.length, preview: `${v.slice(0, 6)}...${v.slice(-4)}`, value: v };
  };

  return new Response(
    JSON.stringify({
      GOOGLE_MAIL_API_KEY: mask(Deno.env.get('GOOGLE_MAIL_API_KEY')),
      GOOGLE_MAIL_API_KEY_1: mask(Deno.env.get('GOOGLE_MAIL_API_KEY_1')),
      GOOGLE_MAIL_API_KEY_2: mask(Deno.env.get('GOOGLE_MAIL_API_KEY_2')),
    }, null, 2),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
