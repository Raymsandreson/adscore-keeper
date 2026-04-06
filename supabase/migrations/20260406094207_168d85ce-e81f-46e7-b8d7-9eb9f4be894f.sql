
CREATE TABLE public.field_variable_aliases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  variable_name TEXT NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  field_type TEXT NOT NULL DEFAULT 'text',
  extraction_pattern TEXT,
  validation_pattern TEXT,
  validation_message TEXT,
  is_auto_generated BOOLEAN NOT NULL DEFAULT false,
  agent_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_field_variable_aliases_unique 
  ON public.field_variable_aliases (variable_name, COALESCE(agent_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX idx_field_variable_aliases_agent ON public.field_variable_aliases(agent_id);

ALTER TABLE public.field_variable_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read field aliases" ON public.field_variable_aliases FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert field aliases" ON public.field_variable_aliases FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update field aliases" ON public.field_variable_aliases FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete field aliases" ON public.field_variable_aliases FOR DELETE TO authenticated USING (true);

CREATE TRIGGER update_field_variable_aliases_updated_at
  BEFORE UPDATE ON public.field_variable_aliases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.field_variable_aliases (variable_name, aliases, field_type, extraction_pattern, validation_pattern, validation_message, is_auto_generated) VALUES
  ('{{NOME COMPLETO}}', ARRAY['nome', 'nome completo', 'meu nome', 'nome do cliente', 'nome outorgante'], 'text', NULL, '^[A-Za-zÀ-ÿ\s]{3,}$', 'Nome deve ter pelo menos 3 caracteres', true),
  ('{{CPF}}', ARRAY['cpf', 'meu cpf', 'documento cpf'], 'cpf', '(\d{3}[\.\s]?\d{3}[\.\s]?\d{3}[-\s]?\d{2})', '^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$', 'CPF deve ter 11 dígitos', true),
  ('{{RG}}', ARRAY['rg', 'identidade', 'registro geral'], 'rg', NULL, NULL, NULL, true),
  ('{{EMAIL}}', ARRAY['email', 'e-mail', 'meu email'], 'email', '([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})', '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', 'Email inválido', true),
  ('{{TELEFONE}}', ARRAY['telefone', 'celular', 'whatsapp', 'fone'], 'phone', '(\(?\d{2}\)?\s?\d{4,5}[-\s]?\d{4})', NULL, NULL, true),
  ('{{CEP}}', ARRAY['cep', 'código postal'], 'cep', '(\d{5}[-\s]?\d{3})', '^\d{5}-?\d{3}$', 'CEP deve ter 8 dígitos', true),
  ('{{ENDERECO}}', ARRAY['endereço', 'rua', 'logradouro', 'onde mora'], 'text', NULL, NULL, NULL, true),
  ('{{BAIRRO}}', ARRAY['bairro'], 'text', NULL, NULL, NULL, true),
  ('{{CIDADE}}', ARRAY['cidade', 'município'], 'text', NULL, NULL, NULL, true),
  ('{{ESTADO}}', ARRAY['estado', 'uf'], 'text', NULL, NULL, NULL, true),
  ('{{NACIONALIDADE}}', ARRAY['nacionalidade'], 'text', NULL, NULL, NULL, true),
  ('{{ESTADO CIVIL}}', ARRAY['estado civil', 'casado', 'solteiro', 'divorciado', 'viúvo'], 'text', NULL, NULL, NULL, true),
  ('{{PROFISSAO}}', ARRAY['profissão', 'ocupação', 'trabalho', 'emprego'], 'text', NULL, NULL, NULL, true),
  ('{{DATA DE NASCIMENTO}}', ARRAY['nascimento', 'data de nascimento', 'aniversário', 'quando nasceu'], 'date', '(\d{2}[/\-\.]\d{2}[/\-\.]\d{4})', '^\d{2}[/\-\.]\d{2}[/\-\.]\d{4}$', 'Data no formato DD/MM/AAAA', true);
