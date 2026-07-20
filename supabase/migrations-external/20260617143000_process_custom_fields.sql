-- Campos personalizados por PROCESSO (espelho de lead_custom_fields)
-- Escopo por workflow_id = kanban_boards(board_type='workflow'), análogo ao board_id do lead.
-- Banco: EXTERNO (kmedldlepwiityjsdahz) — mesma instância de lead_processes,
-- lead_custom_fields e kanban_boards (ver src/integrations/supabase/db-routing.ts).

-- 1) Definições de campo (por workflow)
CREATE TABLE public.process_custom_fields (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ad_account_id TEXT,
  workflow_id UUID REFERENCES public.kanban_boards(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text', -- text, number, date, select, checkbox, url, password
  field_options TEXT[] DEFAULT '{}',       -- usado por field_type = 'select'
  is_required BOOLEAN DEFAULT false,
  display_order INTEGER DEFAULT 0,
  tab TEXT NOT NULL DEFAULT 'basic',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_process_custom_fields_workflow_id
  ON public.process_custom_fields(workflow_id);

-- 2) Valores por processo
CREATE TABLE public.process_custom_field_values (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  process_id UUID NOT NULL REFERENCES public.lead_processes(id) ON DELETE CASCADE,
  field_id UUID NOT NULL REFERENCES public.process_custom_fields(id) ON DELETE CASCADE,
  value_text TEXT,
  value_number NUMERIC,
  value_date DATE,
  value_boolean BOOLEAN,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(process_id, field_id)
);

-- Índice pra planilha de perícias: filtra por campo + data sem varrer a EAV inteira.
CREATE INDEX idx_process_custom_field_values_field_date
  ON public.process_custom_field_values(field_id, value_date);

-- 3) RLS — espelha o padrão aberto das tabelas de lead (USING true).
--    NOTA DE SEGURANÇA: política permissiva, idêntica a lead_custom_fields.
--    Restringir a usuário autenticado é mudança separada (decisão do usuário: espelhar).
ALTER TABLE public.process_custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.process_custom_field_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read process_custom_fields"
  ON public.process_custom_fields FOR SELECT USING (true);
CREATE POLICY "Anyone can insert process_custom_fields"
  ON public.process_custom_fields FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update process_custom_fields"
  ON public.process_custom_fields FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete process_custom_fields"
  ON public.process_custom_fields FOR DELETE USING (true);

CREATE POLICY "Anyone can read process_custom_field_values"
  ON public.process_custom_field_values FOR SELECT USING (true);
CREATE POLICY "Anyone can insert process_custom_field_values"
  ON public.process_custom_field_values FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update process_custom_field_values"
  ON public.process_custom_field_values FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete process_custom_field_values"
  ON public.process_custom_field_values FOR DELETE USING (true);
