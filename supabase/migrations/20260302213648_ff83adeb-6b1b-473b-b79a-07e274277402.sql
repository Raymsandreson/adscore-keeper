
-- Tabela para rastrear documentos ZapSign
CREATE TABLE public.zapsign_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  doc_token TEXT NOT NULL,
  template_id TEXT,
  template_name TEXT,
  document_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  original_file_url TEXT,
  signed_file_url TEXT,
  sign_url TEXT,
  
  -- Vínculos CRM
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  legal_case_id UUID REFERENCES public.legal_cases(id) ON DELETE SET NULL,
  
  -- Dados do signatário
  signer_name TEXT,
  signer_token TEXT,
  signer_email TEXT,
  signer_phone TEXT,
  signer_status TEXT DEFAULT 'new',
  signed_at TIMESTAMPTZ,
  
  -- Dados preenchidos no template
  template_data JSONB DEFAULT '[]'::jsonb,
  
  -- Metadados
  created_by UUID,
  sent_via_whatsapp BOOLEAN DEFAULT false,
  whatsapp_phone TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.zapsign_documents ENABLE ROW LEVEL SECURITY;

-- Policies - authenticated users can manage documents
CREATE POLICY "Authenticated users can view documents"
  ON public.zapsign_documents FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can create documents"
  ON public.zapsign_documents FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update documents"
  ON public.zapsign_documents FOR UPDATE
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete documents"
  ON public.zapsign_documents FOR DELETE
  TO authenticated USING (true);

-- Trigger for updated_at
CREATE TRIGGER update_zapsign_documents_updated_at
  BEFORE UPDATE ON public.zapsign_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Index for quick lookups
CREATE INDEX idx_zapsign_documents_lead ON public.zapsign_documents(lead_id);
CREATE INDEX idx_zapsign_documents_contact ON public.zapsign_documents(contact_id);
CREATE INDEX idx_zapsign_documents_doc_token ON public.zapsign_documents(doc_token);
CREATE INDEX idx_zapsign_documents_status ON public.zapsign_documents(status);
