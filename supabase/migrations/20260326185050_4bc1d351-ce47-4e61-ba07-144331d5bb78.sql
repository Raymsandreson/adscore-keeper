
CREATE TABLE public.case_process_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES public.legal_cases(id) ON DELETE SET NULL,
  lead_id UUID,
  cliente TEXT,
  caso TEXT,
  cpf TEXT,
  senha_gov TEXT,
  data_criacao TEXT,
  tipo TEXT,
  acolhedor TEXT,
  numero_processo TEXT,
  pendencia TEXT,
  data_gerar_guia TEXT,
  data_nascimento_bebe TEXT,
  protocolado TEXT,
  data_protocolo_cancelamento TEXT,
  tempo_dias INTEGER,
  status_processo TEXT,
  data_decisao_final TEXT,
  motivo_indeferimento TEXT,
  observacao TEXT,
  cliente_no_grupo TEXT,
  atividade_criada TEXT,
  pago_acolhedor TEXT,
  data_pagamento TEXT,
  import_source TEXT DEFAULT 'manual',
  imported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.case_process_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view tracking" ON public.case_process_tracking
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert tracking" ON public.case_process_tracking
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update tracking" ON public.case_process_tracking
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete tracking" ON public.case_process_tracking
  FOR DELETE TO authenticated USING (true);

CREATE TRIGGER update_case_process_tracking_updated_at
  BEFORE UPDATE ON public.case_process_tracking
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
