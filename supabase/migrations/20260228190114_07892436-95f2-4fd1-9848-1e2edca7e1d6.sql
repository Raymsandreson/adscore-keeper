
-- Tabela de produtos/serviços vinculados a empresas
CREATE TABLE public.products_services (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  ticket_tier TEXT NOT NULL DEFAULT 'medium' CHECK (ticket_tier IN ('low', 'medium', 'high')),
  product_type TEXT DEFAULT 'service' CHECK (product_type IN ('product', 'service', 'subscription', 'consulting')),
  strategy_focus TEXT DEFAULT 'cash' CHECK (strategy_focus IN ('cash', 'equity', 'hybrid')),
  area TEXT DEFAULT 'operations' CHECK (area IN ('marketing', 'sales', 'product_engineering', 'tax_planning', 'operations')),
  price_range_min NUMERIC(12,2),
  price_range_max NUMERIC(12,2),
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.products_services ENABLE ROW LEVEL SECURITY;

-- Política permissiva para usuários autenticados
CREATE POLICY "Authenticated users can manage products_services" 
  ON public.products_services FOR ALL 
  USING (true) WITH CHECK (true);

-- Trigger de updated_at
CREATE TRIGGER update_products_services_updated_at
  BEFORE UPDATE ON public.products_services
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Adicionar product_service_id ao financial_entries para rastrear lucratividade por produto
ALTER TABLE public.financial_entries 
  ADD COLUMN product_service_id UUID REFERENCES public.products_services(id);

-- Adicionar cost_center com referência ao produto para análise cruzada
ALTER TABLE public.cost_centers 
  ADD COLUMN product_service_id UUID REFERENCES public.products_services(id),
  ADD COLUMN area TEXT,
  ADD COLUMN ticket_tier TEXT,
  ADD COLUMN strategy_focus TEXT;
