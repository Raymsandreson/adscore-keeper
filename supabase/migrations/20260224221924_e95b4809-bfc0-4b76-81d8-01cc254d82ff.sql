
-- Add case_number to leads table
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS case_number text;

-- Create lead_processes table for judicial/administrative processes
CREATE TABLE public.lead_processes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  process_type text NOT NULL DEFAULT 'judicial' CHECK (process_type IN ('judicial', 'administrativo')),
  process_number text,
  title text NOT NULL,
  description text,
  workflow_id text,
  workflow_name text,
  status text NOT NULL DEFAULT 'em_andamento' CHECK (status IN ('em_andamento', 'concluido', 'arquivado')),
  started_at date DEFAULT CURRENT_DATE,
  finished_at date,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.lead_processes ENABLE ROW LEVEL SECURITY;

-- RLS policies - same as leads (open access for authenticated users)
CREATE POLICY "Authenticated users can manage lead_processes" ON public.lead_processes
  FOR ALL USING (true) WITH CHECK (true);

-- Update trigger
CREATE TRIGGER update_lead_processes_updated_at
  BEFORE UPDATE ON public.lead_processes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_processes;
