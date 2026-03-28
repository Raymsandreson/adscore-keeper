
-- First, drop all foreign key constraints referencing whatsapp_ai_agents
ALTER TABLE agent_automation_rules DROP CONSTRAINT IF EXISTS agent_automation_rules_agent_id_fkey;
ALTER TABLE agent_knowledge_documents DROP CONSTRAINT IF EXISTS agent_knowledge_documents_agent_id_fkey;
ALTER TABLE agent_stage_assignments DROP CONSTRAINT IF EXISTS agent_stage_assignments_agent_id_fkey;
ALTER TABLE broadcast_list_agents DROP CONSTRAINT IF EXISTS broadcast_list_agents_agent_id_fkey;

-- Drop the trigger that references whatsapp_ai_agents via agent_stage_assignments
DROP TRIGGER IF EXISTS trigger_auto_swap_agent_on_stage_change ON leads;

-- Drop the empty table
DROP TABLE IF EXISTS whatsapp_ai_agents CASCADE;

-- Create a VIEW with the same name, mapping from wjia_command_shortcuts
CREATE VIEW whatsapp_ai_agents AS
SELECT
  id,
  shortcut_name AS name,
  'lovable' AS provider,
  COALESCE(model, 'google/gemini-2.5-flash') AS model,
  COALESCE(base_prompt, prompt_instructions) AS base_prompt,
  COALESCE(temperature, 0.7)::integer AS temperature,
  COALESCE(max_tokens, 4096) AS max_tokens,
  false AS sign_messages,
  true AS read_messages,
  is_active,
  NULL::text AS uazapi_agent_id,
  NULL::jsonb AS uazapi_config,
  NULL::text AS created_by,
  created_at,
  updated_at,
  COALESCE(response_delay_seconds, 3) AS response_delay_seconds,
  (followup_steps IS NOT NULL AND jsonb_array_length(COALESCE(followup_steps, '[]'::jsonb)) > 0) AS followup_enabled,
  60 AS followup_interval_minutes,
  3 AS followup_max_attempts,
  NULL::text AS followup_message,
  false AS auto_call_enabled,
  'immediate'::text AS auto_call_mode,
  30 AS auto_call_delay_seconds,
  5 AS auto_call_no_response_minutes,
  NULL::text AS auto_call_instance_name,
  COALESCE(human_reply_pause_minutes, 30) AS human_pause_minutes,
  NULL::text AS followup_prompt,
  NULL::uuid AS call_assigned_to,
  COALESCE(split_messages, true) AS split_messages,
  COALESCE(split_delay_seconds, 2) AS split_delay_seconds,
  COALESCE(respond_in_groups, false) AS respond_in_groups,
  COALESCE(reply_with_audio, false) AS reply_with_audio,
  reply_voice_id,
  NULL::text AS stt_prompt,
  max_tts_chars
FROM wjia_command_shortcuts;

-- Re-add foreign keys pointing to wjia_command_shortcuts instead
ALTER TABLE agent_automation_rules 
  ADD CONSTRAINT agent_automation_rules_agent_id_fkey 
  FOREIGN KEY (agent_id) REFERENCES wjia_command_shortcuts(id) ON DELETE CASCADE;

ALTER TABLE agent_knowledge_documents 
  ADD CONSTRAINT agent_knowledge_documents_agent_id_fkey 
  FOREIGN KEY (agent_id) REFERENCES wjia_command_shortcuts(id) ON DELETE CASCADE;

ALTER TABLE agent_stage_assignments 
  ADD CONSTRAINT agent_stage_assignments_agent_id_fkey 
  FOREIGN KEY (agent_id) REFERENCES wjia_command_shortcuts(id) ON DELETE CASCADE;

ALTER TABLE broadcast_list_agents 
  ADD CONSTRAINT broadcast_list_agents_agent_id_fkey 
  FOREIGN KEY (agent_id) REFERENCES wjia_command_shortcuts(id) ON DELETE CASCADE;

-- Recreate the trigger for auto swap agent on stage change
CREATE TRIGGER trigger_auto_swap_agent_on_stage_change
  AFTER UPDATE OF status ON leads
  FOR EACH ROW
  EXECUTE FUNCTION auto_swap_agent_on_stage_change();
