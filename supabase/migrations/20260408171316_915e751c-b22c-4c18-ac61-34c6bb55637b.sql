ALTER TABLE public.wjia_command_shortcuts 
ADD COLUMN notify_instance_name TEXT DEFAULT NULL;

CREATE OR REPLACE VIEW public.whatsapp_ai_agents AS
SELECT id,
    shortcut_name AS name,
    'lovable'::text AS provider,
    COALESCE(model, 'google/gemini-2.5-flash'::text) AS model,
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
    followup_steps IS NOT NULL AND jsonb_array_length(COALESCE(followup_steps, '[]'::jsonb)) > 0 AS followup_enabled,
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
    max_tts_chars,
    COALESCE(send_call_followup_audio, false) AS send_call_followup_audio,
    COALESCE(forward_questions_to_group, false) AS forward_questions_to_group,
    notify_instance_name
FROM wjia_command_shortcuts;

CREATE TABLE IF NOT EXISTS public.agent_group_redirections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL,
  agent_name TEXT,
  phone TEXT NOT NULL,
  instance_name TEXT NOT NULL,
  group_jid TEXT,
  notify_instance_name TEXT,
  group_message TEXT,
  private_notification TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_group_redirections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view redirections"
ON public.agent_group_redirections FOR SELECT
TO authenticated USING (true);

CREATE POLICY "Service can insert redirections"
ON public.agent_group_redirections FOR INSERT
TO authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_agent_group_redirections_created ON public.agent_group_redirections(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_group_redirections_agent ON public.agent_group_redirections(agent_id);