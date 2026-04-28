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

    const ABDER_OLD = "7f41a35e-7d98-4ade-8270-52d727433e6a";
    const ABDER_NEW = "b68dab6e-007f-45fc-ba27-eb378a711124";

    // All activities in the last 30 days assigned to either Abderaman id, but created by SOMEONE ELSE
    const since = new Date(Date.now() - 30*24*60*60*1000).toISOString();
    const { data: cross } = await supabase
      .from("lead_activities")
      .select("id, title, activity_type, created_at, created_by, assigned_to, assigned_to_name, lead_id, action_source, action_source_detail, description")
      .in("assigned_to", [ABDER_OLD, ABDER_NEW])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50);

    const filteredCross = (cross || []).filter((a: any) => 
      a.created_by !== ABDER_OLD && a.created_by !== ABDER_NEW
    );

    // Find user_ids of Maria, Gisele, Maria Lydia, Maria Clara
    const { data: women } = await supabase
      .from("profiles")
      .select("user_id, full_name, email")
      .or("full_name.ilike.%maria%,full_name.ilike.%gisele%,full_name.ilike.%lydia%,full_name.ilike.%clara%");

    // Get lead board for each
    const leadIds = Array.from(new Set(filteredCross.map((a: any) => a.lead_id).filter(Boolean)));
    const { data: leads } = leadIds.length
      ? await supabase.from("leads").select("id, lead_name, board_id, status, created_by, acolhedor").in("id", leadIds)
      : { data: [] };
    const { data: boards } = await supabase.from("kanban_boards").select("id, name");
    const bMap = new Map((boards||[]).map((b: any)=>[b.id, b.name]));
    const leadMap = new Map((leads||[]).map((l: any)=>[l.id, { ...l, board_name: bMap.get(l.board_id) }]));

    // Get profile names of all involved created_by
    const creatorIds = Array.from(new Set((cross||[]).map((a: any) => a.created_by).filter(Boolean)));
    const { data: creators } = creatorIds.length
      ? await supabase.from("profiles").select("user_id, full_name").in("user_id", creatorIds)
      : { data: [] };
    const cMap = new Map((creators||[]).map((p: any)=>[p.user_id, p.full_name]));

    return new Response(JSON.stringify({
      summary: {
        total_to_abder_30d: cross?.length || 0,
        created_by_others_30d: filteredCross.length,
      },
      activities_to_abder_created_by_others: filteredCross.map((a: any) => ({
        ...a,
        created_by_name: cMap.get(a.created_by),
        lead: leadMap.get(a.lead_id),
      })),
      women_profiles: women,
    }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
