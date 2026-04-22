-- Backup of original function (for easy rollback):
-- CREATE OR REPLACE FUNCTION public.auto_classify_contacts_on_lead_close()
--  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
-- AS $function$
-- BEGIN
--   IF NEW.lead_status = 'closed' AND (OLD.lead_status IS DISTINCT FROM 'closed') THEN
--     UPDATE contacts SET classification = 'client', updated_at = now()
--     WHERE whatsapp_group_id IN (SELECT group_jid FROM lead_whatsapp_groups WHERE lead_id = NEW.id)
--       AND (classification IS NULL OR classification != 'client') AND deleted_at IS NULL;
--   END IF;
--   RETURN NEW;
-- END; $function$;

CREATE OR REPLACE FUNCTION public.auto_classify_contacts_on_lead_close()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only fire when lead_status changes to 'closed'
  IF NEW.lead_status = 'closed' AND (OLD.lead_status IS DISTINCT FROM 'closed') THEN
    -- Only classify contacts in the WhatsApp group that are NOT explicitly
    -- linked to this lead via contact_leads. Linked contacts are managed
    -- manually via the CloseLeadGroupDialog UI.
    UPDATE contacts
    SET classification = 'client',
        updated_at = now()
    WHERE whatsapp_group_id IN (
      SELECT group_jid FROM lead_whatsapp_groups WHERE lead_id = NEW.id
    )
    AND id NOT IN (
      SELECT contact_id FROM contact_leads WHERE lead_id = NEW.id
    )
    AND id NOT IN (
      SELECT id FROM contacts WHERE lead_id = NEW.id
    )
    AND (classification IS NULL OR classification != 'client')
    AND deleted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;