import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get the user from the JWT token (Cloud auth)
    const authHeader = req.headers.get('Authorization') || '';
    const cloudUrl = Deno.env.get('SUPABASE_URL')!;
    const cloudKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const cloudClient = createClient(cloudUrl, cloudKey);

    // Verify the user token using getClaims (works with Cloud ES256 signing)
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await cloudClient.auth.getClaims(token);

    if (claimsError || !claimsData?.claims?.sub) {
      console.error('Auth error:', claimsError?.message);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = claimsData.claims.sub as string;
    const userEmail = claimsData.claims.email as string;
    const userMetadata = claimsData.claims.user_metadata as Record<string, any> || {};

    // External DB - single source of truth for all data
    const externalUrl = resolveSupabaseUrl();
    const externalKey = resolveServiceRoleKey();
    const externalClient = createClient(externalUrl, externalKey);

    const fullName = userMetadata?.full_name || userEmail?.split('@')[0] || '';

    // Upsert profile in external DB
    const { data: profile, error: profileError } = await externalClient
      .from('profiles')
      .upsert({
        user_id: userId,
        email: userEmail,
        full_name: fullName,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      .select()
      .single();

    if (profileError) {
      console.error('Profile sync error:', profileError);
      // Don't fail - return partial success
    }

    // Ensure user_roles exists in external
    const { data: existingRole } = await externalClient
      .from('user_roles')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (!existingRole) {
      // Check if this is the first user (admin) or regular member
      const { count } = await externalClient
        .from('user_roles')
        .select('*', { count: 'exact', head: true });

      const role = (count === 0) ? 'admin' : 'member';

      await externalClient
        .from('user_roles')
        .upsert({ user_id: userId, role }, { onConflict: 'user_id,role' });
    }

    // Get the synced profile + role for frontend
    const { data: finalProfile } = await externalClient
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    const { data: userRole } = await externalClient
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .maybeSingle();

    return new Response(JSON.stringify({
      ok: true,
      profile: finalProfile,
      role: userRole?.role || 'member',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('sync-user-to-external error:', error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
