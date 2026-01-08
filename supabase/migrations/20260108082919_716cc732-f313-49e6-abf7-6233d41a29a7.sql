-- Adicionar campos para rastreamento de anúncios
ALTER TABLE public.leads
ADD COLUMN IF NOT EXISTS ad_start_date timestamp with time zone,
ADD COLUMN IF NOT EXISTS ad_name text;

-- Comentário explicativo
COMMENT ON COLUMN public.leads.ad_start_date IS 'Data de início do anúncio relacionado ao lead';
COMMENT ON COLUMN public.leads.ad_name IS 'Nome do anúncio (criativo) associado ao lead';