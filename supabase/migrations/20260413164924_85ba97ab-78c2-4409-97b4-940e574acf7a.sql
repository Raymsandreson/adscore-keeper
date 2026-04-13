-- Trigger function: when a lead is closed, mark contacts in its groups as 'client'
CREATE OR REPLACE FUNCTION public.auto_classify_contacts_on_lead_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only fire when lead_status changes to 'closed'
  IF NEW.lead_status = 'closed' AND (OLD.lead_status IS DISTINCT FROM 'closed') THEN
    UPDATE contacts
    SET classification = 'client',
        updated_at = now()
    WHERE whatsapp_group_id IN (
      SELECT group_jid FROM lead_whatsapp_groups WHERE lead_id = NEW.id
    )
    AND (classification IS NULL OR classification != 'client')
    AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger on leads table
CREATE TRIGGER trg_auto_classify_contacts_on_lead_close
AFTER UPDATE ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.auto_classify_contacts_on_lead_close();
