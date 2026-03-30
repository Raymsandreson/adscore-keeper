import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Verify caller is admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Check admin role
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .maybeSingle();
    
    if (roleData?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Only admins can bulk create users" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

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
        // Check if user already exists
        const { data: existingProfile } = await supabase
          .from("profiles")
          .select("user_id")
          .eq("email", u.email.toLowerCase().trim())
          .maybeSingle();

        if (existingProfile) {
          results.push({ email: u.email, status: "already_exists" });
          continue;
        }

        // Create user via admin API
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
          email: u.email.toLowerCase().trim(),
          password: defaultPassword,
          email_confirm: true,
          user_metadata: {
            full_name: u.full_name,
          },
        });

        if (createError) {
          results.push({ email: u.email, status: "error", error: createError.message });
          continue;
        }

        // Update profile name (trigger creates profile but may not set name correctly)
        if (newUser.user) {
          await supabase
            .from("profiles")
            .update({ full_name: u.full_name, email: u.email.toLowerCase().trim() })
            .eq("user_id", newUser.user.id);

          // Set role
          const role = u.role || "member";
          await supabase
            .from("user_roles")
            .upsert({ user_id: newUser.user.id, role }, { onConflict: "user_id" })
            .select();
        }

        results.push({ email: u.email, status: "created", role: u.role || "member" });
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
