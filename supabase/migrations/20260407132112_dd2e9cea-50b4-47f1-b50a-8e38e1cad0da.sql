CREATE OR REPLACE FUNCTION public.auto_create_lead_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assigned_to UUID;
  v_assigned_name TEXT;
BEGIN
  -- Use lead's assigned_to first, fallback to created_by
  v_assigned_to := COALESCE(NEW.assigned_to, NEW.created_by);
  
  -- Lookup the profile name
  IF v_assigned_to IS NOT NULL THEN
    SELECT full_name INTO v_assigned_name
    FROM public.profiles
    WHERE user_id = v_assigned_to
    LIMIT 1;
  END IF;

  INSERT INTO public.lead_activities (
    lead_id, lead_name, title, description,
    activity_type, status, priority,
    assigned_to, assigned_to_name, created_by, deadline
  ) VALUES (
    NEW.id, NEW.lead_name, 'Dar andamento',
    'Atividade criada automaticamente para garantir acompanhamento do lead.',
    'tarefa', 'pendente', 'normal',
    v_assigned_to, v_assigned_name, NEW.created_by, CURRENT_DATE
  );
  RETURN NEW;
END;
$$;