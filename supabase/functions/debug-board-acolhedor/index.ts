import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = (Deno.env.get("EXTERNAL_SUPABASE_URL") || "").trim();
    const key = (Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || "").trim();
    const supabase = createClient(url, key);

    const MYSTERY_ID = "7f41a35e-7d98-4ade-8270-52d727433e6a";
    const REAL_ABDER = "b68dab6e-007f-45fc-ba27-eb378a711124";

    // Profile lookup for the mystery ID
    const { data: mysteryProfile } = await supabase
      .from("profiles").select("*").eq("user_id", MYSTERY_ID).maybeSingle();

    // Search ALL Abderaman profiles
    const { data: allAbder } = await supabase
      .from("profiles")
      .select("user_id, full_name, email, created_at")
      .ilike("full_name", "%abderam%");

    // Search team_members 
    const { data: tm1 } = await supabase
      .from("team_members")
      .select("*")
      .or(`user_id.eq.${MYSTERY_ID},user_id.eq.${REAL_ABDER}`).limit(10);

    // Counts of activities by assigned_to per id
    const { count: actsMystery } = await supabase
      .from("lead_activities").select("id", { count: "exact", head: true })
      .eq("assigned_to", MYSTERY_ID);
    const { count: actsReal } = await supabase
      .from("lead_activities").select("id", { count: "exact", head: true })
      .eq("assigned_to", REAL_ABDER);

    // Where is mystery used as created_by in activities?
    const { count: createdByMystery } = await supabase
      .from("lead_activities").select("id", { count: "exact", head: true })
      .eq("created_by", MYSTERY_ID);

    // Activity types related to "previdenc" 
    const { data: actTypes } = await supabase
      .from("activity_types")
      .select("*")
      .or("name.ilike.%previd%,key.ilike.%previd%,category.ilike.%previd%");

    // Look for any default_assignee or default_user setting
    const { data: settings } = await supabase
      .from("activity_field_settings")
      .select("*").limit(50);

    return new Response(JSON.stringify({
      mystery_id: MYSTERY_ID,
      mystery_profile_lookup: mysteryProfile,
      all_abderaman_profiles: allAbder,
      team_members_match: tm1,
      counts: {
        activities_assigned_to_mystery: actsMystery,
        activities_assigned_to_real_abder: actsReal,
        activities_created_by_mystery: createdByMystery,
      },
      activity_types_previdenc: actTypes,
      activity_field_settings_sample: settings,
    }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
