
-- Trigger function: auto-create "Dar andamento" activity when a lead is inserted
CREATE OR REPLACE FUNCTION public.auto_create_lead_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
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
  )
  VALUES (
    NEW.id,
    NEW.lead_name,
    'Dar andamento',
    'Atividade criada automaticamente para garantir acompanhamento do lead.',
    'tarefa',
    'pendente',
    'normal',
    NEW.created_by,
    NULL,
    NEW.created_by,
    (CURRENT_DATE + INTERVAL '1 day')::date
  );
  RETURN NEW;
END;
$function$;

-- Create the trigger on leads table
CREATE TRIGGER trg_auto_create_lead_activity
AFTER INSERT ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.auto_create_lead_activity();
