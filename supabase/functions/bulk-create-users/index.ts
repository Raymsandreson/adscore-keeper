import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // CLOUD Supabase - where auth lives
    const cloudUrl = Deno.env.get('SUPABASE_URL')!;
    const cloudServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const cloudClient = createClient(cloudUrl, cloudServiceKey);

    // EXTERNAL Supabase - where profiles/roles live
    const externalUrl = resolveSupabaseUrl();
    const externalKey = resolveServiceRoleKey();
    const externalClient = createClient(externalUrl, externalKey);

    const { users } = await req.json();

    if (!users || !Array.isArray(users)) {
      return new Response(JSON.stringify({ error: "users array required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const results = [];
    const defaultPassword = "WhatsJud2026!";

    for (const u of users) {
      try {
        const email = u.email.toLowerCase().trim();
        const password = u.password || defaultPassword;
        const fullName = u.full_name || email.split('@')[0];
        const role = u.role || "member";

        // 1. Create/update auth user on CLOUD
        let userId: string | null = null;

        const { data: newUser, error: createError } = await cloudClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: fullName },
        });

        if (createError) {
          if (createError.message?.includes('already been registered') || createError.message?.includes('already exists')) {
            // User exists on Cloud - find and update
            const { data: listData } = await cloudClient.auth.admin.listUsers();
            const existing = listData?.users?.find(usr => usr.email === email);
            if (existing) {
              userId = existing.id;
              // Update password if provided explicitly
              if (u.password) {
                await cloudClient.auth.admin.updateUserById(existing.id, {
                  password,
                  email_confirm: true,
                });
              }
            }
          } else {
            results.push({ email, status: "error", error: createError.message });
            continue;
          }
        } else {
          userId = newUser.user?.id || null;
        }

        if (!userId) {
          results.push({ email, status: "error", error: "Could not resolve user ID" });
          continue;
        }

        // 2. Sync profile and role to EXTERNAL DB
        await externalClient.from("profiles").upsert({
          user_id: userId,
          full_name: fullName,
          email,
        }, { onConflict: "user_id" });

        await externalClient.from("user_roles").upsert({
          user_id: userId,
          role,
        }, { onConflict: "user_id" });

        // 3. Also ensure minimal profile on Cloud for compatibility
        await cloudClient.from("profiles").upsert({
          user_id: userId,
          full_name: fullName,
          email,
        }, { onConflict: "user_id" });

        await cloudClient.from("user_roles").upsert({
          user_id: userId,
          role,
        }, { onConflict: "user_id" });

        results.push({ email, status: createError ? "already_exists_updated" : "created", role });
      } catch (err) {
        results.push({ email: u.email, status: "error", error: err.message });
      }
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
