
-- Add closed_at column to legal_cases
ALTER TABLE public.legal_cases 
ADD COLUMN IF NOT EXISTS closed_at DATE;

-- Create trigger function to auto-close lead when a case is created
CREATE OR REPLACE FUNCTION public.auto_close_lead_on_case_creation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_board_id UUID;
  v_stages JSONB;
  v_last_stage_id TEXT;
  v_closed_date DATE;
BEGIN
  -- Only act when a new case is created with a lead_id
  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Use closed_at if provided, otherwise use current date
  v_closed_date := COALESCE(NEW.closed_at, CURRENT_DATE);

  -- Get the lead's board_id and its stages
  SELECT l.board_id, kb.stages::jsonb
  INTO v_board_id, v_stages
  FROM leads l
  JOIN kanban_boards kb ON kb.id = l.board_id
  WHERE l.id = NEW.lead_id;

  IF v_board_id IS NULL OR v_stages IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get the last stage ID from the stages array
  v_last_stage_id := v_stages->(-1)->>'id';

  IF v_last_stage_id IS NOT NULL THEN
    -- Move lead to the last stage and set as closed
    UPDATE leads
    SET status = v_last_stage_id,
        lead_status = 'closed',
        updated_at = now()
    WHERE id = NEW.lead_id;
  END IF;

  -- Update closed_at on the case if it wasn't set
  IF NEW.closed_at IS NULL THEN
    NEW.closed_at := v_closed_date;
  END IF;

  RETURN NEW;
END;
$$;

-- Create the trigger
DROP TRIGGER IF EXISTS trigger_auto_close_lead_on_case ON public.legal_cases;
CREATE TRIGGER trigger_auto_close_lead_on_case
  BEFORE INSERT ON public.legal_cases
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_close_lead_on_case_creation();
