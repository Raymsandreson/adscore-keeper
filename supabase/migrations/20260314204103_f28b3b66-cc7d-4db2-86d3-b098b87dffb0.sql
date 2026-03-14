
-- Function to execute followup and auto-cleanup the cron job
CREATE OR REPLACE FUNCTION public.execute_and_cleanup_followup(p_session_id UUID, p_job_name TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Call the edge function
  PERFORM net.http_post(
    url := 'https://gliigkupoebmlbwyvijp.supabase.co/functions/v1/wjia-followup-processor',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsaWlna3Vwb2VibWxid3l2aWpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMDAxNDcsImV4cCI6MjA4MTU3NjE0N30.HnhqYYFjW9DjFUsUkrZDuCShCOU2P73o_DqvkVyVr38"}'::jsonb,
    body := format('{"session_id": "%s"}', p_session_id)::jsonb
  );
  -- Cleanup: remove the one-time cron job
  PERFORM cron.unschedule(p_job_name);
END;
$$;

-- Function to schedule a followup for a specific session after N minutes
CREATE OR REPLACE FUNCTION public.schedule_followup_for_session(p_session_id UUID, p_delay_minutes INT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_name TEXT;
  v_target_time TIMESTAMPTZ;
  v_cron_expr TEXT;
BEGIN
  v_job_name := 'followup_' || replace(p_session_id::TEXT, '-', '');
  v_target_time := now() + (p_delay_minutes || ' minutes')::interval;
  
  -- Build cron expression for exact target time (minute hour day month *)
  v_cron_expr := EXTRACT(MINUTE FROM v_target_time)::INT || ' ' ||
                 EXTRACT(HOUR FROM v_target_time)::INT || ' ' ||
                 EXTRACT(DAY FROM v_target_time)::INT || ' ' ||
                 EXTRACT(MONTH FROM v_target_time)::INT || ' *';
  
  -- Remove existing job if any
  BEGIN
    PERFORM cron.unschedule(v_job_name);
  EXCEPTION WHEN OTHERS THEN
    -- Job doesn't exist, ignore
    NULL;
  END;
  
  -- Schedule one-time job
  PERFORM cron.schedule(
    v_job_name,
    v_cron_expr,
    format(
      'SELECT public.execute_and_cleanup_followup(''%s''::uuid, ''%s'')',
      p_session_id::TEXT,
      v_job_name
    )
  );
END;
$$;

-- Trigger function: when session status becomes 'generated', schedule first followup
CREATE OR REPLACE FUNCTION public.trigger_followup_on_generated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule RECORD;
  v_first_delay INT;
BEGIN
  IF NEW.status = 'generated' AND (OLD IS NULL OR OLD.status IS DISTINCT FROM 'generated') THEN
    -- Get first step delay from active rules
    SELECT * INTO v_rule 
    FROM wjia_followup_rules 
    WHERE is_active = true 
    ORDER BY display_order 
    LIMIT 1;
    
    IF v_rule IS NOT NULL AND v_rule.steps IS NOT NULL THEN
      v_first_delay := COALESCE((v_rule.steps->0->>'delay_minutes')::INT, 60);
    ELSE
      v_first_delay := 60;
    END IF;
    
    PERFORM public.schedule_followup_for_session(NEW.id, v_first_delay);
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger
DROP TRIGGER IF EXISTS trg_followup_on_generated ON public.wjia_collection_sessions;
CREATE TRIGGER trg_followup_on_generated
  AFTER INSERT OR UPDATE ON public.wjia_collection_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_followup_on_generated();
