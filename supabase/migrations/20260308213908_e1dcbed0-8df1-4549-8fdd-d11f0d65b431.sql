
-- Trigger: auto-create follow-up when outbound WhatsApp message is sent to a lead
CREATE OR REPLACE FUNCTION public.auto_followup_on_outbound_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only for outbound messages linked to a lead
  IF NEW.direction = 'outbound' AND NEW.lead_id IS NOT NULL THEN
    INSERT INTO public.lead_followups (lead_id, followup_type, followup_date, notes)
    VALUES (NEW.lead_id, 'whatsapp', NOW(), 'Mensagem enviada automaticamente registrada');

    -- Update lead counters
    UPDATE public.leads
    SET followup_count = COALESCE(followup_count, 0) + 1,
        last_followup_at = NOW()
    WHERE id = NEW.lead_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_followup_outbound_message
AFTER INSERT ON public.whatsapp_messages
FOR EACH ROW
EXECUTE FUNCTION public.auto_followup_on_outbound_message();

-- Trigger: auto-create follow-up when a call is recorded for a lead
CREATE OR REPLACE FUNCTION public.auto_followup_on_call_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    INSERT INTO public.lead_followups (lead_id, followup_type, followup_date, notes)
    VALUES (NEW.lead_id, 'call', NOW(), 'Ligação registrada automaticamente');

    -- Update lead counters
    UPDATE public.leads
    SET followup_count = COALESCE(followup_count, 0) + 1,
        last_followup_at = NOW()
    WHERE id = NEW.lead_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_followup_call_record
AFTER INSERT ON public.call_records
FOR EACH ROW
EXECUTE FUNCTION public.auto_followup_on_call_record();
