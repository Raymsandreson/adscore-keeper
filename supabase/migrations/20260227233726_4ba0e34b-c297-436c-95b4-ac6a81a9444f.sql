
-- 1. Núcleos Especializados
CREATE TABLE public.specialized_nuclei (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sequence_counter INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Casos
CREATE TABLE public.legal_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  nucleus_id UUID REFERENCES public.specialized_nuclei(id) ON DELETE SET NULL,
  case_number TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'aberto',
  outcome TEXT,
  outcome_date DATE,
  assigned_to UUID,
  created_by UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Partes do Processo
CREATE TABLE public.process_parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  process_id UUID NOT NULL REFERENCES public.lead_processes(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'autor',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(process_id, contact_id, role)
);

-- 4. Adicionar case_id ao lead_processes
ALTER TABLE public.lead_processes ADD COLUMN case_id UUID REFERENCES public.legal_cases(id) ON DELETE CASCADE;

-- 5. Função para gerar número sequencial
CREATE OR REPLACE FUNCTION public.generate_case_number(p_nucleus_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_prefix TEXT;
  v_next_seq INTEGER;
  v_case_number TEXT;
BEGIN
  IF p_nucleus_id IS NULL THEN
    SELECT COALESCE(MAX(CAST(SUBSTRING(case_number FROM '[0-9]+$') AS INTEGER)), 0) + 1
    INTO v_next_seq
    FROM legal_cases
    WHERE nucleus_id IS NULL;
    v_case_number := 'CASO-' || LPAD(v_next_seq::TEXT, 4, '0');
  ELSE
    SELECT prefix INTO v_prefix FROM specialized_nuclei WHERE id = p_nucleus_id;
    UPDATE specialized_nuclei 
    SET sequence_counter = sequence_counter + 1, updated_at = now()
    WHERE id = p_nucleus_id
    RETURNING sequence_counter INTO v_next_seq;
    v_case_number := v_prefix || '-' || LPAD(v_next_seq::TEXT, 4, '0');
  END IF;
  RETURN v_case_number;
END;
$$;

-- 6. RLS
ALTER TABLE public.specialized_nuclei ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.process_parties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage nuclei" ON public.specialized_nuclei
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can manage legal_cases" ON public.legal_cases
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can manage process_parties" ON public.process_parties
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- 7. Triggers updated_at
CREATE TRIGGER update_specialized_nuclei_updated_at
  BEFORE UPDATE ON public.specialized_nuclei
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_legal_cases_updated_at
  BEFORE UPDATE ON public.legal_cases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 8. Índices
CREATE INDEX idx_legal_cases_lead_id ON public.legal_cases(lead_id);
CREATE INDEX idx_legal_cases_nucleus_id ON public.legal_cases(nucleus_id);
CREATE INDEX idx_legal_cases_status ON public.legal_cases(status);
CREATE INDEX idx_process_parties_process_id ON public.process_parties(process_id);
CREATE INDEX idx_process_parties_contact_id ON public.process_parties(contact_id);
CREATE INDEX idx_lead_processes_case_id ON public.lead_processes(case_id);
