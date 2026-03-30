
-- 1. Add 'inviavel' to lead_status options (no enum, it's a text field, but let's add the status_reason and status dates)
ALTER TABLE public.leads 
  ADD COLUMN IF NOT EXISTS lead_status_reason text,
  ADD COLUMN IF NOT EXISTS lead_status_changed_at timestamptz;

-- 2. Create lead_status_history table for tracking all status changes with dates and reasons
CREATE TABLE IF NOT EXISTS public.lead_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  reason text,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lead_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view lead status history"
  ON public.lead_status_history FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert lead status history"
  ON public.lead_status_history FOR INSERT TO authenticated WITH CHECK (true);

CREATE INDEX idx_lead_status_history_lead_id ON public.lead_status_history(lead_id);
CREATE INDEX idx_lead_status_history_changed_at ON public.lead_status_history(changed_at);

-- 3. Create lead_financials table for expenses/revenues per lead
CREATE TABLE IF NOT EXISTS public.lead_financials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  case_id uuid REFERENCES public.legal_cases(id) ON DELETE SET NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('entrada', 'saida')),
  amount numeric(12,2) NOT NULL,
  description text,
  category text,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lead_financials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view lead financials"
  ON public.lead_financials FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert lead financials"
  ON public.lead_financials FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update lead financials"
  ON public.lead_financials FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete lead financials"
  ON public.lead_financials FOR DELETE TO authenticated USING (true);

CREATE INDEX idx_lead_financials_lead_id ON public.lead_financials(lead_id);
CREATE INDEX idx_lead_financials_case_id ON public.lead_financials(case_id);

CREATE TRIGGER update_lead_financials_updated_at
  BEFORE UPDATE ON public.lead_financials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Add CAC field to leads
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS cac numeric(12,2);
