import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = (Deno.env.get("EXTERNAL_SUPABASE_URL") || "").trim();
    const key = (Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || "").trim();
    const supabase = createClient(url, key);

    const ABDER_OLD = "7f41a35e-7d98-4ade-8270-52d727433e6a";

    // Fetch full table list
    const r = await fetch(`${url}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    const j: any = await r.json();
    const tables: string[] = j?.definitions ? Object.keys(j.definitions) : (j?.paths ? Object.keys(j.paths).map((p:string)=>p.replace(/^\//,"")).filter((s)=>s && !s.includes("/")) : []);

    const skip = new Set([
      "lead_activities","leads","contacts","whatsapp_messages","webhook_logs","conversations","ai_conversation_history",
      "team_chat_messages","activity_chat_messages","activity_attachments","whatsapp_messages","lead_followups",
      "lead_stage_history","lead_status_history","goal_history","outbound_goal_history","monitor_kpi_snapshots",
      "user_sessions","user_activity_log","engagement_daily_stats","engagement_rankings","whatsapp_call_queue",
      "call_events_pending","call_records","manychat_interactions","instagram_comments","external_posts",
      "promoted_posts","meta_ads_cache","meta_daily_metrics","instagram_metrics","instagram_search_history",
      "instagram_auto_replies","instagram_accounts","whatsapp_campaign_messages","whatsapp_campaigns",
      "credit_card_transactions","bank_transactions","financial_entries","loans","investments","beneficiaries",
      "expense_form_responses","expense_form_tokens","cat_lead_contacts","cat_leads","cbo_professions",
      "broadcast_sends","broadcast_list_members","broadcast_list_agents","broadcast_lists","whatsapp_broadcast_lists",
      "whatsapp_broadcast_list_contacts","dm_history","wjia_followup_log","whatsapp_agent_followups",
      "whatsapp_command_history","wjia_collection_sessions","manychat_agent_config","conversation_attribution",
      "v_conversations_with_attribution","whatsapp_conversation_agents","whatsapp_conversation_shares",
      "whatsapp_internal_notes","whatsapp_private_conversations","process_movement_notifications",
      "process_movement_monitors","case_process_tracking","lead_processes","process_parties",
      "lead_enrichment_log","meta_enrichment_queue","n8n_automation_logs","n8n_comment_schedules",
      "transaction_category_overrides","pluggy_connections","google_oauth_tokens","google_scheduled_actions",
      "team_chat_mentions","changelog_acknowledgments","bug_reports","group_creation_queue","campaign_action_history",
      "engagement_championship_settings","engagement_goals","engagement_champions","commission_goals",
      "lead_drive_folders","lead_financials","lead_whatsapp_groups","lead_custom_field_values",
      "checklist_stage_links","lead_checklist_instances","weekly_evaluations","contact_leads","contact_relationships",
      "contact_professions","zapsign_documents","ad_briefings","custom_voices","voice_preferences",
      "user_timeblock_settings","user_daily_goal_defaults","whatsapp_report_config","whatsapp_notification_config",
      "whatsapp_instances","whatsapp_instance_users","whatsapp_agent_campaign_links","whatsapp_ai_agents",
      "agent_knowledge_documents","form_layout_tabs","form_layout_fields","wjia_command_shortcuts",
      "purchase_groups","whatsapp_command_config","commission_tiers","daily_goal_snapshots","workflow_daily_goals",
      "workflow_reports","metric_definitions","lead_sources","team_invitations","teams","companies","profiles",
      "system_settings","contact_relationship_types","contact_classifications","kanban_boards","activity_types",
      "category_api_mappings","cost_centers","cost_accounts","expense_categories","products_services",
      "specialized_nuclei","company_areas","job_positions","career_plans","career_plan_steps","member_positions",
      "profile_oab_entries","activity_field_settings","field_stage_requirements","analysis_criteria",
      "call_field_suggestions","account_category_links","user_account_permissions","user_card_permissions",
      "user_roles","team_members","member_metric_goals","member_assistant_config","member_module_permissions"
    ]);

    const targets = tables.filter((t) => !skip.has(t));
    const hits: any = {};
    for (const t of targets) {
      try {
        const { data, error } = await supabase.from(t).select("*").limit(2000);
        if (error) continue;
        const matches = (data||[]).filter((r: any) => JSON.stringify(r).includes(ABDER_OLD));
        if (matches.length) hits[t] = { count: matches.length, samples: matches.slice(0, 5) };
      } catch {}
    }
    // Force-include some interesting tables even if in skip
    for (const t of ["agent_automation_rules","checklist_templates","agent_stage_assignments","wjia_followup_rules","member_area_assignments","member_module_permissions","member_metric_goals","routine_process_goals","workflow_default_goals","board_group_settings","board_group_instances","field_stage_requirements","activity_field_settings","activity_types","activity_message_templates","card_assignments"]) {
      try {
        const { data, error } = await supabase.from(t).select("*").limit(2000);
        if (error) continue;
        const matches = (data||[]).filter((r: any) => JSON.stringify(r).includes(ABDER_OLD));
        if (matches.length) hits[t] = { count: matches.length, samples: matches.slice(0, 5) };
      } catch {}
    }

    return new Response(JSON.stringify({ scanned: targets.length, hits }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
