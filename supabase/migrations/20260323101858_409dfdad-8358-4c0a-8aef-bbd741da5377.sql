
-- Trigger to auto-swap agent when lead changes stage
CREATE OR REPLACE FUNCTION public.auto_swap_agent_on_stage_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_new_agent_id UUID;
  v_lead_phone TEXT;
BEGIN
  -- Only fire when status (stage) actually changes
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.board_id IS NOT NULL AND NEW.status IS NOT NULL THEN
    -- Check if there's an agent assigned to the new stage
    SELECT agent_id INTO v_new_agent_id
    FROM agent_stage_assignments
    WHERE board_id = NEW.board_id AND stage_id = NEW.status
    LIMIT 1;

    -- Get lead phone
    v_lead_phone := NEW.lead_phone;
    
    IF v_lead_phone IS NOT NULL AND v_lead_phone != '' THEN
      -- Normalize phone
      v_lead_phone := regexp_replace(v_lead_phone, '\D', '', 'g');
      
      IF v_new_agent_id IS NOT NULL THEN
        -- Swap the agent in conversation_agents
        UPDATE whatsapp_conversation_agents
        SET agent_id = v_new_agent_id, 
            is_active = true,
            human_paused_until = NULL,
            activated_by = 'stage_auto'
        WHERE phone LIKE '%' || right(v_lead_phone, 8) || '%';
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_auto_swap_agent_on_stage_change
  BEFORE UPDATE OF status ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_swap_agent_on_stage_change();
