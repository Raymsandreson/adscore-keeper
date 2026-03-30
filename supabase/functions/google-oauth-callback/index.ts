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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state'); // contains user_id
  const error = url.searchParams.get('error');

  if (error) {
    return new Response(`
      <html><body>
        <script>
          window.opener?.postMessage({ type: 'google-oauth-error', error: '${error}' }, '*');
          window.close();
        </script>
        <p>Erro: ${error}. Pode fechar esta janela.</p>
      </body></html>
    `, { headers: { 'Content-Type': 'text/html' } });
  }

  if (!code || !state) {
    return new Response('Parâmetros inválidos', { status: 400 });
  }

  const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!;
  const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;
  const SUPABASE_URL = RESOLVED_SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = RESOLVED_SERVICE_ROLE_KEY;

  const redirectUri = `${SUPABASE_URL}/functions/v1/google-oauth-callback`;

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const tokens = await tokenRes.json();

  if (!tokenRes.ok || !tokens.access_token) {
    console.error('Token exchange error:', tokens);
    return new Response(`
      <html><body>
        <script>
          window.opener?.postMessage({ type: 'google-oauth-error', error: 'token_exchange_failed' }, '*');
          window.close();
        </script>
        <p>Erro ao obter tokens. Pode fechar esta janela.</p>
      </body></html>
    `, { headers: { 'Content-Type': 'text/html' } });
  }

  // Save tokens to database
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const userId = state;

  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();

  const { error: dbError } = await supabase
    .from('google_oauth_tokens')
    .upsert({
      user_id: userId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expires_at: expiresAt,
      scope: tokens.scope || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

  if (dbError) {
    console.error('DB error:', dbError);
  }

  return new Response(`
    <html><body>
      <script>
        window.opener?.postMessage({ type: 'google-oauth-success' }, '*');
        window.close();
      </script>
      <p>✅ Google conectado com sucesso! Pode fechar esta janela.</p>
    </body></html>
  `, { headers: { 'Content-Type': 'text/html' } });
});
