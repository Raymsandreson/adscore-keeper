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

    const OLD = "7f41a35e-7d98-4ade-8270-52d727433e6a";

    // Inspect a couple of activities created_by OLD to see what produced them
    const { data: created } = await supabase
      .from("lead_activities")
      .select("*")
      .eq("created_by", OLD)
      .order("created_at", { ascending: false })
      .limit(15);

    // Check workflow / process / routine references
    const tables = [
      "workflow_steps", "workflow_objectives", "workflow_phases", 
      "routine_processes", "routine_process_goals", "routine_member_assignments",
      "activity_message_templates", "activity_types",
      "agent_stage_assignments", "agent_role_assignments",
      "card_assignments", "checklists", "checklist_items",
      "field_stage_requirements", "module_permissions", "access_profiles",
      "kanban_boards", "module_assignments", "instance_assignments",
    ];

    const hits: Record<string, any> = {};
    for (const t of tables) {
      try {
        const { data, error } = await supabase.from(t).select("*").limit(1000);
        if (error) { hits[t] = { error: error.message }; continue; }
        const matches = (data || []).filter((row: any) => JSON.stringify(row).includes(OLD));
        if (matches.length) hits[t] = { count: matches.length, samples: matches.slice(0, 3) };
      } catch (e) {
        hits[t] = { error: String(e) };
      }
    }

    return new Response(JSON.stringify({
      old_id: OLD,
      activities_created_by_old: created,
      tables_referencing_old_id: hits,
    }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
