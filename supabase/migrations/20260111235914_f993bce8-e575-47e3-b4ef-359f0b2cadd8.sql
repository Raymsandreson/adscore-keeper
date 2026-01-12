-- Tabela para armazenar histórico de metas completadas/expiradas
CREATE TABLE public.goal_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  goal_title TEXT NOT NULL,
  goal_type TEXT NOT NULL,
  target_value NUMERIC NOT NULL,
  achieved_value NUMERIC NOT NULL,
  unit TEXT,
  deadline DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed', -- completed, overdue, cancelled
  achievement_percentage NUMERIC,
  period_start DATE,
  period_end DATE,
  notes TEXT,
  ad_account_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.goal_history ENABLE ROW LEVEL SECURITY;

-- Políticas de acesso público (sem auth)
CREATE POLICY "Allow all access to goal_history" 
ON public.goal_history 
FOR ALL 
USING (true)
WITH CHECK (true);

-- Índice para busca por período
CREATE INDEX idx_goal_history_period ON public.goal_history (period_end DESC);
CREATE INDEX idx_goal_history_type ON public.goal_history (goal_type);