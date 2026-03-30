import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = Deno.env.get('EXTERNAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
const RESOLVED_SERVICE_ROLE_KEY = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = RESOLVED_SUPABASE_URL;
    const serviceRoleKey = RESOLVED_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

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
        
        // Check if user already exists by listing users
        const { data: listData } = await supabase.auth.admin.listUsers();
        const existing = listData?.users?.find(usr => usr.email === email);

        if (existing) {
          // Ensure profile and role exist
          await supabase.from("profiles").upsert({
            user_id: existing.id,
            full_name: u.full_name,
            email: email,
          }, { onConflict: "user_id" });
          
          await supabase.from("user_roles").upsert({
            user_id: existing.id,
            role: u.role || "member",
          }, { onConflict: "user_id" });

          results.push({ email, status: "already_exists_updated" });
          continue;
        }

        // Create user via admin API
        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
          email,
          password: defaultPassword,
          email_confirm: true,
          user_metadata: { full_name: u.full_name },
        });

        if (createError) {
          results.push({ email, status: "error", error: createError.message });
          continue;
        }

        if (newUser.user) {
          await supabase.from("profiles").upsert({
            user_id: newUser.user.id,
            full_name: u.full_name,
            email,
          }, { onConflict: "user_id" });

          await supabase.from("user_roles").upsert({
            user_id: newUser.user.id,
            role: u.role || "member",
          }, { onConflict: "user_id" });
        }

        results.push({ email, status: "created", role: u.role || "member" });
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
