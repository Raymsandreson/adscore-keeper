CREATE OR REPLACE FUNCTION public.auto_create_lead_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_assigned_to uuid;
  v_assigned_name text;
BEGIN
  v_assigned_to := NEW.created_by;

  IF v_assigned_to IS NULL AND NEW.acolhedor IS NOT NULL AND btrim(NEW.acolhedor) <> '' THEN
    SELECT p.user_id, p.full_name
      INTO v_assigned_to, v_assigned_name
    FROM public.profiles p
    WHERE lower(btrim(p.full_name)) = lower(btrim(NEW.acolhedor))
    ORDER BY p.created_at ASC
    LIMIT 1;
  END IF;

  IF v_assigned_name IS NULL AND v_assigned_to IS NOT NULL THEN
    SELECT p.full_name
      INTO v_assigned_name
    FROM public.profiles p
    WHERE p.user_id = v_assigned_to
    LIMIT 1;
  END IF;

  INSERT INTO public.lead_activities (
    lead_id,
    lead_name,
    title,
    description,
    activity_type,
    status,
    priority,
    assigned_to,
    assigned_to_name,
    created_by,
    deadline
  ) VALUES (
    NEW.id,
    NEW.lead_name,
    'Dar andamento',
    'Atividade criada automaticamente para garantir acompanhamento do lead.',
    'tarefa',
    'pendente',
    'normal',
    v_assigned_to,
    v_assigned_name,
    NEW.created_by,
    CURRENT_DATE
  );

  RETURN NEW;
END;
$function$;