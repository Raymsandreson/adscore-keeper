import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = Deno.env.get('EXTERNAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
const RESOLVED_SERVICE_ROLE_KEY = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function refreshToken(refreshToken: string): Promise<string | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  return data.access_token || null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

  const supabase = createClient(
    RESOLVED_SUPABASE_URL,
    RESOLVED_ANON_KEY,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

  const body = await req.json();
  const { name, phone, email, notes, instagram_username } = body;

  // Get user tokens using service role
  const serviceSupabase = createClient(RESOLVED_SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY);
  const { data: tokenRow } = await serviceSupabase
    .from('google_oauth_tokens')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!tokenRow) {
    return new Response(JSON.stringify({ error: 'google_not_connected' }), { status: 400, headers: corsHeaders });
  }

  let accessToken = tokenRow.access_token;

  // Refresh if expired
  if (tokenRow.expires_at && new Date(tokenRow.expires_at) <= new Date() && tokenRow.refresh_token) {
    const newToken = await refreshToken(tokenRow.refresh_token);
    if (newToken) {
      accessToken = newToken;
      await serviceSupabase.from('google_oauth_tokens').update({
        access_token: newToken,
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      }).eq('user_id', user.id);
    }
  }

  // Build contact resource
  const contactResource: any = { names: [{ givenName: name }] };
  if (phone) contactResource.phoneNumbers = [{ value: phone, type: 'mobile' }];
  if (email) contactResource.emailAddresses = [{ value: email }];

  const bioLines = [];
  if (instagram_username) bioLines.push(`Instagram: @${instagram_username}`);
  if (notes) bioLines.push(notes);
  if (bioLines.length > 0) contactResource.biographies = [{ value: bioLines.join('\n'), contentType: 'TEXT_PLAIN' }];

  const res = await fetch('https://people.googleapis.com/v1/people:createContact', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(contactResource),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error('Google People API error:', data);
    return new Response(JSON.stringify({ error: 'google_api_error', details: data }), { status: 500, headers: corsHeaders });
  }

  return new Response(JSON.stringify({ success: true, contact: data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
