-- Tabela de documentos processuais
CREATE TABLE public.process_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  process_id UUID REFERENCES public.lead_processes(id) ON DELETE CASCADE,
  case_id UUID REFERENCES public.legal_cases(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  document_type TEXT NOT NULL DEFAULT 'outro',
  title TEXT NOT NULL,
  description TEXT,
  source TEXT NOT NULL DEFAULT 'manual_upload',
  escavador_document_id TEXT,
  zapsign_document_id TEXT,
  file_url TEXT,
  file_name TEXT,
  file_size INTEGER,
  original_url TEXT,
  document_date DATE,
  metadata JSONB DEFAULT '{}',
  uploaded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_process_documents_process_id ON public.process_documents(process_id);
CREATE INDEX idx_process_documents_case_id ON public.process_documents(case_id);
CREATE INDEX idx_process_documents_lead_id ON public.process_documents(lead_id);
CREATE INDEX idx_process_documents_document_type ON public.process_documents(document_type);
CREATE INDEX idx_process_documents_source ON public.process_documents(source);
CREATE INDEX idx_process_documents_escavador_id ON public.process_documents(escavador_document_id);
CREATE INDEX idx_process_documents_zapsign_id ON public.process_documents(zapsign_document_id);

-- RLS
ALTER TABLE public.process_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view process documents"
  ON public.process_documents FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert process documents"
  ON public.process_documents FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update process documents"
  ON public.process_documents FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete process documents"
  ON public.process_documents FOR DELETE TO authenticated USING (true);

-- Updated_at trigger
CREATE TRIGGER update_process_documents_updated_at
  BEFORE UPDATE ON public.process_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();