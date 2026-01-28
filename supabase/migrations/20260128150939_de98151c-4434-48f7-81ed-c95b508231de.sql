-- Remove the restrictive check constraint on leads.status to allow dynamic kanban stage IDs
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_status_check;

-- Add a comment explaining that status now accepts either legacy values or kanban stage IDs
COMMENT ON COLUMN public.leads.status IS 'Can be legacy values (new, contacted, qualified, converted, lost, comment) or dynamic kanban stage UUIDs';