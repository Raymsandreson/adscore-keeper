-- Add shortcut_name and agent_id to sessions so followup can find the steps
ALTER TABLE public.wjia_collection_sessions 
  ADD COLUMN IF NOT EXISTS shortcut_name TEXT,
  ADD COLUMN IF NOT EXISTS agent_id UUID;

-- Update trigger to read followup_steps from wjia_command_shortcuts instead of wjia_followup_rules
CREATE OR REPLACE FUNCTION public.trigger_followup_on_generated()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_steps JSONB;
  v_first_delay INT;
BEGIN
  IF NEW.status = 'generated' AND (OLD IS NULL OR OLD.status IS DISTINCT FROM 'generated') THEN
    -- Read followup_steps from the shortcut linked to this session
    IF NEW.shortcut_name IS NOT NULL THEN
      SELECT followup_steps INTO v_steps
      FROM wjia_command_shortcuts
      WHERE shortcut_name = NEW.shortcut_name
        AND is_active = true
      LIMIT 1;
    END IF;
    
    IF v_steps IS NOT NULL AND jsonb_array_length(v_steps) > 0 THEN
      v_first_delay := COALESCE((v_steps->0->>'delay_minutes')::INT, 60);
    ELSE
      -- No followup steps configured, don't schedule
      RETURN NEW;
    END IF;
    
    PERFORM public.schedule_followup_for_session(NEW.id, v_first_delay);
  END IF;
  RETURN NEW;
END;
$function$;