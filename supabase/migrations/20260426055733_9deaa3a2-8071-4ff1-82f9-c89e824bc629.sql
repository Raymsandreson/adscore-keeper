-- Adiciona campos de identificação e endereço para enriquecimento via ZapSign
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS cpf TEXT,
  ADD COLUMN IF NOT EXISTS rg TEXT,
  ADD COLUMN IF NOT EXISTS cep TEXT,
  ADD COLUMN IF NOT EXISTS street TEXT,
  ADD COLUMN IF NOT EXISTS street_number TEXT,
  ADD COLUMN IF NOT EXISTS complement TEXT,
  ADD COLUMN IF NOT EXISTS birth_date DATE;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS cpf TEXT,
  ADD COLUMN IF NOT EXISTS rg TEXT,
  ADD COLUMN IF NOT EXISTS cep TEXT,
  ADD COLUMN IF NOT EXISTS street TEXT,
  ADD COLUMN IF NOT EXISTS street_number TEXT,
  ADD COLUMN IF NOT EXISTS complement TEXT,
  ADD COLUMN IF NOT EXISTS neighborhood TEXT,
  ADD COLUMN IF NOT EXISTS birth_date DATE;

-- Adiciona vínculo template ZapSign -> Funil Kanban
ALTER TABLE public.kanban_boards
  ADD COLUMN IF NOT EXISTS zapsign_template_id TEXT;

CREATE INDEX IF NOT EXISTS idx_kanban_boards_zapsign_template
  ON public.kanban_boards (zapsign_template_id)
  WHERE zapsign_template_id IS NOT NULL;

-- Índice em leads.cpf pra deduplicar futuras importações
CREATE INDEX IF NOT EXISTS idx_leads_cpf ON public.leads (cpf) WHERE cpf IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_cpf ON public.contacts (cpf) WHERE cpf IS NOT NULL;