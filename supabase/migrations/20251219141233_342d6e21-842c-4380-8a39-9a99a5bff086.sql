-- Adiciona campo para armazenar o ID do lead no Facebook
ALTER TABLE public.leads 
ADD COLUMN IF NOT EXISTS facebook_lead_id text;

-- Adiciona campo para status de sincronização
ALTER TABLE public.leads 
ADD COLUMN IF NOT EXISTS sync_status text DEFAULT 'local';

-- Adiciona campo para última tentativa de sincronização
ALTER TABLE public.leads 
ADD COLUMN IF NOT EXISTS last_sync_at timestamp with time zone;

-- Adiciona índice para busca por facebook_lead_id
CREATE INDEX IF NOT EXISTS idx_leads_facebook_lead_id ON public.leads(facebook_lead_id);

-- Comentários para documentação
COMMENT ON COLUMN public.leads.facebook_lead_id IS 'ID do lead no Facebook Lead Ads para sincronização de status';
COMMENT ON COLUMN public.leads.sync_status IS 'Status de sincronização: local, synced, error';
COMMENT ON COLUMN public.leads.last_sync_at IS 'Última tentativa de sincronização com Facebook';