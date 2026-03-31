import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = resolveSupabaseUrl();
const RESOLVED_SERVICE_ROLE_KEY = resolveServiceRoleKey();
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response(JSON.stringify({ connected: false }), { headers: corsHeaders });

  const supabase = createClient(
    RESOLVED_SUPABASE_URL,
    RESOLVED_ANON_KEY,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response(JSON.stringify({ connected: false }), { headers: corsHeaders });

  const { data } = await supabase
    .from('google_oauth_tokens')
    .select('id, expires_at, scope')
    .eq('user_id', user.id)
    .maybeSingle();

  return new Response(JSON.stringify({ connected: !!data, expires_at: data?.expires_at, scope: data?.scope }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
