
-- Tabela de métricas diárias do Meta BM
CREATE TABLE public.meta_daily_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  metric_date DATE NOT NULL DEFAULT CURRENT_DATE,
  account_id TEXT,
  -- Métricas automáticas (preenchidas pela edge function)
  leads_received INTEGER NOT NULL DEFAULT 0,
  leads_qualified INTEGER NOT NULL DEFAULT 0,
  creatives_active INTEGER NOT NULL DEFAULT 0,
  spend NUMERIC(12,2) DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  -- Campos editáveis pelo usuário
  manual_creatives_uploaded INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  what_worked TEXT,
  next_actions TEXT,
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Unique constraint: um registro por usuário por dia por conta
  UNIQUE (user_id, metric_date, account_id)
);

-- Trigger para updated_at
CREATE TRIGGER update_meta_daily_metrics_updated_at
  BEFORE UPDATE ON public.meta_daily_metrics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.meta_daily_metrics ENABLE ROW LEVEL SECURITY;

-- Usuário pode ver e editar seus próprios dados
CREATE POLICY "Users can view own meta metrics"
  ON public.meta_daily_metrics FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

CREATE POLICY "Users can insert own meta metrics"
  ON public.meta_daily_metrics FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_admin(auth.uid()));

CREATE POLICY "Users can update own meta metrics"
  ON public.meta_daily_metrics FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

-- Índices
CREATE INDEX idx_meta_daily_metrics_user_date ON public.meta_daily_metrics (user_id, metric_date);
CREATE INDEX idx_meta_daily_metrics_date ON public.meta_daily_metrics (metric_date);
