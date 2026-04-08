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
    const body = await req.json();
    const { action, user_id, email, full_name, phone } = body;

    if (!user_id || (!email && action !== 'update_profile')) {
      return new Response(JSON.stringify({ error: 'Missing user_id or email' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // External DB - single source of truth for all data
    const externalUrl = resolveSupabaseUrl();
    const externalKey = resolveServiceRoleKey();
    const externalClient = createClient(externalUrl, externalKey);

    // Handle profile update from admin (MemberDetailSheet)
    if (action === 'update_profile') {
      const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
      if (full_name !== undefined) updateData.full_name = full_name;
      if (email !== undefined) updateData.email = email;
      if (phone !== undefined) updateData.phone = phone;

      const { error } = await externalClient
        .from('profiles')
        .update(updateData)
        .eq('user_id', user_id);

      if (error) {
        console.error('Profile update error:', error);
        return new Response(JSON.stringify({ ok: false, error: error.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const name = full_name || email.split('@')[0] || '';

    // Check if profile already exists with a real name — never overwrite a manually-set name
    const { data: existingProfile } = await externalClient
      .from('profiles')
      .select('full_name')
      .eq('user_id', user_id)
      .maybeSingle();

    const existingName = existingProfile?.full_name || '';
    const isExistingNameReal = existingName && existingName !== email && !existingName.includes('@') && !/^\+?\d[\d\s\-()]*$/.test(existingName.trim());
    
    // Only set name if there's no real name already saved
    const profileData: Record<string, any> = {
      user_id,
      email,
      updated_at: new Date().toISOString(),
    };
    if (!isExistingNameReal) {
      profileData.full_name = name;
    }

    // Upsert profile in external DB
    const { error: profileError } = await externalClient
      .from('profiles')
      .upsert(profileData, { onConflict: 'user_id' })
      .select()
      .single();

    if (profileError) {
      console.error('Profile sync error:', profileError);
    }

    // Check if there's a pending invitation for this email
    const { data: invitation } = await externalClient
      .from('team_invitations')
      .select('*')
      .eq('email', email.toLowerCase())
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Ensure user_roles exists in external
    const { data: existingRole } = await externalClient
      .from('user_roles')
      .select('id, role')
      .eq('user_id', user_id)
      .maybeSingle();

    const assignedRole = invitation?.role || (existingRole ? existingRole.role : null);

    if (!existingRole) {
      const { count } = await externalClient
        .from('user_roles')
        .select('*', { count: 'exact', head: true });

      const role = assignedRole || ((count === 0) ? 'admin' : 'member');

      await externalClient
        .from('user_roles')
        .upsert({ user_id, role }, { onConflict: 'user_id,role' });
    }

    // If invitation exists, apply pre-configured permissions
    if (invitation) {
      // Apply module permissions
      const modulePerms = invitation.module_permissions || [];
      if (Array.isArray(modulePerms) && modulePerms.length > 0) {
        const permRows = modulePerms.map((p: any) => ({
          user_id,
          module_key: p.module_key,
          access_level: p.access_level,
        }));
        await externalClient
          .from('member_module_permissions')
          .upsert(permRows, { onConflict: 'user_id,module_key' });
      }

      // Apply WhatsApp instance access
      const instanceIds = invitation.whatsapp_instance_ids || [];
      if (Array.isArray(instanceIds) && instanceIds.length > 0) {
        const instanceRows = instanceIds.map((instance_id: string) => ({
          user_id,
          instance_id,
        }));
        await externalClient
          .from('whatsapp_instance_users')
          .upsert(instanceRows, { onConflict: 'user_id,instance_id' });
      }

      // Mark invitation as accepted
      await externalClient
        .from('team_invitations')
        .update({ accepted_at: new Date().toISOString() })
        .eq('id', invitation.id);

      console.log(`Invitation accepted for ${email}, permissions applied`);
    }

    // Get the synced profile + role for frontend
    const { data: finalProfile } = await externalClient
      .from('profiles')
      .select('*')
      .eq('user_id', user_id)
      .single();

    const { data: userRole } = await externalClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user_id)
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
