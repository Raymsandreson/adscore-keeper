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

    // 1. Find Abderaman profile
    const { data: abder } = await supabase
      .from("profiles")
      .select("user_id, full_name, email")
      .or("full_name.ilike.%abderam%,full_name.ilike.%abdera%");

    const abderIds = (abder || []).map((a: any) => a.user_id);

    // 2. List ALL kanban boards
    const { data: boards } = await supabase
      .from("kanban_boards")
      .select("id, name");

    // 3. List ALL board_group_settings (no filter)
    const { data: settings } = await supabase
      .from("board_group_settings")
      .select("*");

    // 4. Recent leads assigned to Abderaman
    const { data: recentLeads } = abderIds.length
      ? await supabase
          .from("leads")
          .select("id, lead_name, board_id, created_by, assigned_to, acolhedor, created_at, action_source, action_source_detail")
          .in("assigned_to", abderIds)
          .order("created_at", { ascending: false })
          .limit(20)
      : { data: [] };

    // 5. Recent activities assigned to Abderaman
    const { data: recentActs } = abderIds.length
      ? await supabase
          .from("lead_activities")
          .select("id, lead_id, lead_name, title, assigned_to, assigned_to_name, created_by, created_at")
          .in("assigned_to", abderIds)
          .order("created_at", { ascending: false })
          .limit(20)
      : { data: [] };

    return new Response(JSON.stringify({
      abderaman: abder,
      total_boards: boards?.length || 0,
      boards: boards,
      total_settings: settings?.length || 0,
      settings_with_processual: (settings || []).filter((s: any) => s.processual_acolhedor_id),
      recent_leads_to_abder: recentLeads,
      recent_activities_to_abder: recentActs,
    }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
