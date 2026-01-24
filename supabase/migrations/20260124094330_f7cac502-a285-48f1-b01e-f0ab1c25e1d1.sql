-- Habilitar extensões necessárias
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Criar tabela de agendamentos
CREATE TABLE public.n8n_comment_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  interval_minutes INTEGER NOT NULL DEFAULT 30,
  max_comments_per_run INTEGER DEFAULT 5,
  auto_post BOOLEAN DEFAULT false,
  tone TEXT DEFAULT 'friendly',
  last_run_at TIMESTAMP WITH TIME ZONE,
  next_run_at TIMESTAMP WITH TIME ZONE,
  total_runs INTEGER DEFAULT 0,
  total_replies INTEGER DEFAULT 0,
  cron_job_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.n8n_comment_schedules ENABLE ROW LEVEL SECURITY;

-- Policies para acesso público (como outras tabelas do projeto)
CREATE POLICY "Anyone can read schedules" 
ON public.n8n_comment_schedules 
FOR SELECT USING (true);

CREATE POLICY "Anyone can insert schedules" 
ON public.n8n_comment_schedules 
FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update schedules" 
ON public.n8n_comment_schedules 
FOR UPDATE USING (true);

CREATE POLICY "Anyone can delete schedules" 
ON public.n8n_comment_schedules 
FOR DELETE USING (true);

-- Trigger para updated_at
CREATE TRIGGER update_n8n_comment_schedules_updated_at
BEFORE UPDATE ON public.n8n_comment_schedules
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();