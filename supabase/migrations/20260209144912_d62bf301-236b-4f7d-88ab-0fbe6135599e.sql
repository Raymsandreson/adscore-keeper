
-- Tabela principal de leads CAT
CREATE TABLE public.cat_leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Dados do Acidente
  agente_causador TEXT,
  cbo TEXT,
  cid_10 TEXT,
  cnae_empregador TEXT,
  filiacao_segurado TEXT,
  indica_obito BOOLEAN DEFAULT false,
  municipio_empregador TEXT,
  natureza_lesao TEXT,
  origem_cadastramento TEXT,
  parte_corpo_atingida TEXT,
  sexo TEXT,
  tipo_acidente TEXT,
  uf_municipio_acidente TEXT,
  uf_municipio_empregador TEXT,
  data_afastamento DATE,
  data_acidente DATE,
  data_nascimento DATE,
  data_emissao_cat DATE,
  tipo_empregador TEXT,
  cnpj_cei_empregador TEXT,
  -- Dados da Vítima
  cpf TEXT,
  nome_completo TEXT NOT NULL,
  endereco TEXT,
  bairro TEXT,
  cep TEXT,
  municipio TEXT,
  uf TEXT,
  -- Telefones
  celular_1 TEXT,
  resultado_celular_1 TEXT,
  celular_2 TEXT,
  resultado_celular_2 TEXT,
  celular_3 TEXT,
  resultado_celular_3 TEXT,
  celular_4 TEXT,
  resultado_celular_4 TEXT,
  fixo_1 TEXT,
  resultado_fixo_1 TEXT,
  fixo_2 TEXT,
  resultado_fixo_2 TEXT,
  fixo_3 TEXT,
  resultado_fixo_3 TEXT,
  fixo_4 TEXT,
  resultado_fixo_4 TEXT,
  -- Gerenciamento
  contact_status TEXT DEFAULT 'pending',
  assigned_to UUID,
  priority TEXT DEFAULT 'normal',
  notes TEXT,
  lead_id UUID,
  imported_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  import_batch_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabela de histórico de contatos/follow-ups
CREATE TABLE public.cat_lead_contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cat_lead_id UUID NOT NULL REFERENCES public.cat_leads(id) ON DELETE CASCADE,
  contacted_by UUID,
  contact_channel TEXT NOT NULL DEFAULT 'whatsapp',
  contact_result TEXT NOT NULL DEFAULT 'no_answer',
  phone_used TEXT,
  notes TEXT,
  next_action TEXT,
  next_action_date TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.cat_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cat_lead_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read cat_leads" ON public.cat_leads FOR SELECT USING (true);
CREATE POLICY "Anyone can insert cat_leads" ON public.cat_leads FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update cat_leads" ON public.cat_leads FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete cat_leads" ON public.cat_leads FOR DELETE USING (true);

CREATE POLICY "Anyone can read cat_lead_contacts" ON public.cat_lead_contacts FOR SELECT USING (true);
CREATE POLICY "Anyone can insert cat_lead_contacts" ON public.cat_lead_contacts FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update cat_lead_contacts" ON public.cat_lead_contacts FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete cat_lead_contacts" ON public.cat_lead_contacts FOR DELETE USING (true);

-- Trigger updated_at
CREATE TRIGGER update_cat_leads_updated_at
  BEFORE UPDATE ON public.cat_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
