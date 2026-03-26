-- Add lead_status column for business status (separate from kanban stage)
ALTER TABLE public.leads 
ADD COLUMN IF NOT EXISTS lead_status TEXT NOT NULL DEFAULT 'active';

-- Migrate leads currently in closed/refused stages
-- Set lead_status = 'closed' for leads in closed-like stages
UPDATE public.leads SET lead_status = 'closed' 
WHERE status IN ('closed', 'done', 'fechados', 'done_1774362831584');

-- Set lead_status = 'refused' for leads in refused-like stages  
UPDATE public.leads SET lead_status = 'refused'
WHERE status IN ('recusado', 'recusados', 'not_qualified', 'lost', 'recusado_1771942429815', 'recusado_1771942486194', 'recusado_1774362938593');

-- Set lead_status = 'refused' for 'inviável' and 'inviáveis' stages
UPDATE public.leads SET lead_status = 'refused'
WHERE status IN ('inviável', 'inviáveis');

-- For leads that were in closed/refused stages, move them to the last real funnel stage
-- We need to keep them visible somewhere in the funnel
-- Board: Acidente de Trabalho - move closed/refused/inviável to last real stage
UPDATE public.leads SET status = 'post_visit' 
WHERE board_id = '2dcd54b5-502b-413b-b795-5e24a20797d2' 
  AND status IN ('closed', 'recusado_1771942429815', 'inviável');

-- Board: Auxílio Acidente - move to last real stage
UPDATE public.leads SET status = 'progress_1774362831584'
WHERE board_id = 'b922f490-3600-4652-a629-5d63110501ca'
  AND status IN ('done_1774362831584', 'recusado_1774362938593');

-- Board: Auxílio-Maternidade - move to last real stage
UPDATE public.leads SET status = 'finalização_e_pagamento_1771617203545_qakx'
WHERE board_id = '48d6581d-b138-45f9-bb63-84d90ba86ec2'
  AND status IN ('fechados', 'recusados', 'inviáveis');

-- Board: Leads Inbound - move to last real stage (need to check)
UPDATE public.leads SET status = 'post_visit'
WHERE board_id = 'ccd46376-5a8c-42ea-a0f4-3360ed2b1e7a'
  AND status IN ('closed', 'not_qualified', 'recusado_1771942486194');

-- Board: Previdenciário - move to last real stage
UPDATE public.leads SET status = 'inviável'
WHERE board_id = 'c8e8c466-c441-43a9-88d2-8197324c47a4'
  AND status IN ('done', 'recusado');

-- Create index for fast filtering
CREATE INDEX IF NOT EXISTS idx_leads_lead_status ON public.leads(lead_status);