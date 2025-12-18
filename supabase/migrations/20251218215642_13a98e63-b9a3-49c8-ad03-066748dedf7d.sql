-- Tabela para rastrear leads do WhatsApp e suas conversões
CREATE TABLE public.leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ad_account_id TEXT,
  campaign_id TEXT,
  campaign_name TEXT,
  adset_id TEXT,
  adset_name TEXT,
  creative_id TEXT,
  creative_name TEXT,
  lead_name TEXT,
  lead_phone TEXT,
  lead_email TEXT,
  source TEXT DEFAULT 'whatsapp',
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'not_qualified', 'converted', 'lost')),
  ad_spend_at_conversion DECIMAL(10,2) DEFAULT 0,
  conversion_value DECIMAL(10,2) DEFAULT 0,
  notes TEXT,
  qualified_at TIMESTAMP WITH TIME ZONE,
  converted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Política para permitir leitura pública (pode ser restrito depois)
CREATE POLICY "Anyone can read leads"
ON public.leads
FOR SELECT
USING (true);

-- Política para permitir inserção pública
CREATE POLICY "Anyone can insert leads"
ON public.leads
FOR INSERT
WITH CHECK (true);

-- Política para permitir atualização pública
CREATE POLICY "Anyone can update leads"
ON public.leads
FOR UPDATE
USING (true);

-- Política para permitir deleção pública
CREATE POLICY "Anyone can delete leads"
ON public.leads
FOR DELETE
USING (true);

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION public.update_leads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_leads_updated_at
BEFORE UPDATE ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.update_leads_updated_at();

-- Índices para performance
CREATE INDEX idx_leads_ad_account ON public.leads(ad_account_id);
CREATE INDEX idx_leads_campaign ON public.leads(campaign_id);
CREATE INDEX idx_leads_status ON public.leads(status);
CREATE INDEX idx_leads_created_at ON public.leads(created_at DESC);