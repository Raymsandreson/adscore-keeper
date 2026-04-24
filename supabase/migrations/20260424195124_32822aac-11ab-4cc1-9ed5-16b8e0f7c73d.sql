-- Disable the auto-close trigger so creating a legal case no longer
-- automatically moves the lead to the last stage / closed status.
DROP TRIGGER IF EXISTS trg_auto_close_lead_on_case ON public.legal_cases;