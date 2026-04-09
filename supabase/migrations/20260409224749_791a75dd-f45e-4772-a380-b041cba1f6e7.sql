-- Tabela para snapshots pré-computados de KPIs do monitor
CREATE TABLE public.monitor_kpi_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL UNIQUE,
  
  -- Detalhes individuais dos leads fechados (para filtragem client-side)
  closed_lead_details JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Agregados de fechamento (totais globais sem filtro)
  closed_aggregates JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Métricas de conversação
  conversation_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Detalhes de novas conversas
  new_conv_details JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- Métricas operacionais (contagens globais)
  operational_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Detalhes operacionais (arrays para filtragem)
  operational_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Gaps operacionais
  gap_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index para busca rápida por data
CREATE INDEX idx_monitor_kpi_snapshots_date ON public.monitor_kpi_snapshots(snapshot_date);

-- RLS
ALTER TABLE public.monitor_kpi_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read snapshots"
  ON public.monitor_kpi_snapshots
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage snapshots"
  ON public.monitor_kpi_snapshots
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);