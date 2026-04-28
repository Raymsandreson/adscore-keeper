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

    // Search ALL relevant config tables for that ID
    const tablesToScan = [
      "routine_processes","routine_process_goals","workflow_steps","workflow_objectives","workflow_phases",
      "workflows","activity_message_templates","activity_types","agent_stage_assignments",
      "card_assignments","field_stage_requirements","kanban_boards","board_group_settings",
      "ad_set_geo_rules","module_permissions","instance_permissions","access_profiles",
      "team_members","profiles","analysis_criteria","kanban_stage_assignments","stage_field_settings",
      "lead_followups_config","activity_field_settings","specialized_nuclei","products_services",
      "specialized_assignments","case_assignments","process_default_assignees",
      "auto_activity_rules","auto_assignment_rules"
    ];

    const hits: any = {};
    for (const t of tablesToScan) {
      try {
        const { data, error } = await supabase.from(t).select("*").limit(2000);
        if (error) { hits[t] = `ERR: ${error.message}`; continue; }
        const matches = (data||[]).filter((r: any) => JSON.stringify(r).includes(ABDER_OLD));
        if (matches.length) hits[t] = { count: matches.length, samples: matches };
      } catch (e) { hits[t] = `EXC: ${String(e)}`; }
    }

    return new Response(JSON.stringify({ hits }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
