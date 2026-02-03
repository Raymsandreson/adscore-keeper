-- Adicionar campos específicos de casos de acidentes de trabalho na tabela leads
ALTER TABLE public.leads
ADD COLUMN IF NOT EXISTS acolhedor TEXT,
ADD COLUMN IF NOT EXISTS case_type TEXT,
ADD COLUMN IF NOT EXISTS group_link TEXT,
ADD COLUMN IF NOT EXISTS visit_city TEXT,
ADD COLUMN IF NOT EXISTS visit_state TEXT,
ADD COLUMN IF NOT EXISTS visit_region TEXT,
ADD COLUMN IF NOT EXISTS accident_date DATE,
ADD COLUMN IF NOT EXISTS damage_description TEXT,
ADD COLUMN IF NOT EXISTS victim_name TEXT,
ADD COLUMN IF NOT EXISTS victim_age INTEGER,
ADD COLUMN IF NOT EXISTS accident_address TEXT,
ADD COLUMN IF NOT EXISTS visit_address TEXT,
ADD COLUMN IF NOT EXISTS contractor_company TEXT,
ADD COLUMN IF NOT EXISTS main_company TEXT,
ADD COLUMN IF NOT EXISTS sector TEXT,
ADD COLUMN IF NOT EXISTS news_link TEXT,
ADD COLUMN IF NOT EXISTS company_size_justification TEXT,
ADD COLUMN IF NOT EXISTS liability_type TEXT,
ADD COLUMN IF NOT EXISTS legal_viability TEXT;

-- Adicionar comentários para documentação
COMMENT ON COLUMN public.leads.acolhedor IS 'Nome do acolhedor responsável pelo lead';
COMMENT ON COLUMN public.leads.case_type IS 'Tipo de caso (ex: Acidente de Trabalho, Queda, etc)';
COMMENT ON COLUMN public.leads.group_link IS 'Link do grupo de comunicação';
COMMENT ON COLUMN public.leads.visit_city IS 'Cidade onde será realizada a visita';
COMMENT ON COLUMN public.leads.visit_state IS 'Estado onde será realizada a visita';
COMMENT ON COLUMN public.leads.visit_region IS 'Região da visita (Norte, Sul, etc)';
COMMENT ON COLUMN public.leads.accident_date IS 'Data em que ocorreu o acidente';
COMMENT ON COLUMN public.leads.damage_description IS 'Descrição do dano sofrido';
COMMENT ON COLUMN public.leads.victim_name IS 'Nome da vítima do acidente';
COMMENT ON COLUMN public.leads.victim_age IS 'Idade da vítima';
COMMENT ON COLUMN public.leads.accident_address IS 'Endereço onde ocorreu o acidente';
COMMENT ON COLUMN public.leads.visit_address IS 'Endereço para visita ao lead';
COMMENT ON COLUMN public.leads.contractor_company IS 'Nome da empresa terceirizada';
COMMENT ON COLUMN public.leads.main_company IS 'Nome da empresa tomadora';
COMMENT ON COLUMN public.leads.sector IS 'Setor de atuação';
COMMENT ON COLUMN public.leads.news_link IS 'Link da notícia sobre o acidente';
COMMENT ON COLUMN public.leads.company_size_justification IS 'Justificativa do porte da empresa';
COMMENT ON COLUMN public.leads.liability_type IS 'Tipo de responsabilidade (solidária, subsidiária, etc)';
COMMENT ON COLUMN public.leads.legal_viability IS 'Análise de viabilidade jurídica do caso';