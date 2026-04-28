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

    const ABDER_ID = "b68dab6e-007f-45fc-ba27-eb378a711124";
    const ABDER_NAME_LIKE = "%Abderam%";

    // Activities assigned to Abderaman by assigned_to OR by name
    const { data: actsById, error: e1 } = await supabase
      .from("lead_activities")
      .select("id, lead_id, lead_name, title, activity_type, assigned_to, assigned_to_name, created_by, created_at, description")
      .eq("assigned_to", ABDER_ID)
      .order("created_at", { ascending: false })
      .limit(15);

    const { data: actsByName, error: e2 } = await supabase
      .from("lead_activities")
      .select("id, lead_id, lead_name, title, activity_type, assigned_to, assigned_to_name, created_by, created_at, description")
      .ilike("assigned_to_name", ABDER_NAME_LIKE)
      .order("created_at", { ascending: false })
      .limit(15);

    // Get the leads behind those activities, including board_id and creator
    const leadIds = Array.from(new Set([...(actsById||[]), ...(actsByName||[])].map((a: any) => a.lead_id).filter(Boolean)));
    const { data: leadsInfo } = leadIds.length
      ? await supabase.from("leads").select("id, lead_name, board_id, status, created_by, assigned_to, acolhedor, action_source, action_source_detail, created_at").in("id", leadIds)
      : { data: [] };

    // Profiles for created_by
    const userIds = Array.from(new Set([
      ...(leadsInfo||[]).map((l: any) => l.created_by),
      ...(actsById||[]).map((a: any) => a.created_by),
      ...(actsByName||[]).map((a: any) => a.created_by),
    ].filter(Boolean)));
    const { data: profiles } = userIds.length
      ? await supabase.from("profiles").select("user_id, full_name").in("user_id", userIds)
      : { data: [] };
    const pMap = new Map((profiles||[]).map((p: any)=>[p.user_id, p.full_name]));

    const { data: boards } = await supabase.from("kanban_boards").select("id, name");
    const bMap = new Map((boards||[]).map((b: any)=>[b.id, b.name]));

    const enrichLead = (l: any) => l && ({
      ...l,
      board_name: bMap.get(l.board_id),
      created_by_name: pMap.get(l.created_by),
    });
    const enrichAct = (a: any) => ({
      ...a,
      created_by_name: pMap.get(a.created_by),
      lead: enrichLead((leadsInfo||[]).find((l: any)=>l.id===a.lead_id)),
    });

    return new Response(JSON.stringify({
      errors: { e1: e1?.message, e2: e2?.message },
      activities_assigned_to_abder_by_id: (actsById||[]).map(enrichAct),
      activities_assigned_to_abder_by_name: (actsByName||[]).map(enrichAct),
    }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
